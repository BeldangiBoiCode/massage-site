// Owner connects a calendar account from the Studio page. Admin only (we check the user's token ourselves).
//   { action: 'google-url', return_to }            -> { url }  (send the browser there; Google then calls google-callback)
//   { action: 'apple-save', apple_id, app_password, calendar_name? } -> validates over CalDAV, stores encrypted
//   { action: 'disconnect', id }                    -> removes the connection and its encrypted secret
//   { action: 'sync' }                              -> runs calendar-push now
// Secrets needed: GOOGLE_CLIENT_ID (for the Google button). verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (b: unknown, s = 200) => Response.json(b, { status: s, headers: CORS });

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(payload: string): Promise<string> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(data!.value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64(String.fromCharCode(...new Uint8Array(sig)));
}

/* ---- Apple CalDAV discovery (iCloud) ---- */
const abs = (href: string, base: string) => new URL(href.trim(), base).toString();
async function dav(method: string, url: string, auth: string, body: string, depth = '0') {
  return fetch(url, { method, headers: { Authorization: auth, 'Content-Type': 'application/xml; charset=utf-8', Depth: depth }, body });
}
const first = (xml: string, tag: string) => new RegExp(`<(?:\\w+:)?${tag}[^>]*>\\s*<(?:\\w+:)?href[^>]*>([^<]+)`, 'i').exec(xml)?.[1];

async function appleDiscover(appleId: string, appPassword: string, wanted?: string) {
  const auth = 'Basic ' + btoa(`${appleId}:${appPassword}`);
  const root = 'https://caldav.icloud.com/';
  const r1 = await dav('PROPFIND', root, auth, '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
  if (r1.status === 401) throw new Error('Apple said the Apple ID or app-specific password is wrong.');
  const principal = first(await r1.text(), 'current-user-principal');
  if (!principal) throw new Error('Could not reach iCloud Calendar with those details.');
  const pUrl = abs(principal, root);
  const r2 = await dav('PROPFIND', pUrl, auth, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
  const home = first(await r2.text(), 'calendar-home-set');
  if (!home) throw new Error('iCloud did not return a calendar home.');
  const hUrl = abs(home, pUrl);
  const r3 = await dav('PROPFIND', hUrl, auth,
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>', '1');
  const xml = await r3.text();
  const cals = [...xml.matchAll(/<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/gi)].map((m) => m[1]).map((blk) => ({
    href: /<(?:\w+:)?href[^>]*>([^<]+)/i.exec(blk)?.[1] ?? '',
    name: /<(?:\w+:)?displayname[^>]*>([^<]*)/i.exec(blk)?.[1] ?? '',
    isCal: /<(?:\w+:)?calendar\s*\/>/i.test(blk) && /VEVENT/i.test(blk),
  })).filter((c) => c.isCal);
  if (!cals.length) throw new Error('No calendar found on that Apple account.');
  const pick = (wanted && cals.find((c) => c.name.toLowerCase() === wanted.toLowerCase())) || cals.find((c) => /^(home|calendar)$/i.test(c.name)) || cals[0];
  const ref = abs(pick.href, hUrl);
  return { ref: ref.endsWith('/') ? ref : ref + '/', name: pick.name };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: u } = await db.auth.getUser(jwt);
  if (!u.user) return reply({ error: 'Sign in first.' }, 401);
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!admin) return reply({ error: 'Only the owner can do this.' }, 403);

  const b = await req.json().catch(() => ({}));

  if (b.action === 'google-url') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId) return reply({ error: 'Google is not set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the setup notes).' }, 501);
    const ret = String(b.return_to ?? '');
    if (!/^https?:\/\//.test(ret)) return reply({ error: 'Missing return address.' }, 400);
    const payload = b64(JSON.stringify({ uid: u.user.id, ret, exp: Date.now() + 10 * 60000 }));
    const state = `${payload}.${await sign(payload)}`;
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: `${URL_}/functions/v1/google-callback`, response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email openid',
      access_type: 'offline', prompt: 'consent', state,
    });
    return reply({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  }

  if (b.action === 'apple-save') {
    const appleId = String(b.apple_id ?? '').trim(), pw = String(b.app_password ?? '').replace(/\s/g, '');
    if (!appleId.includes('@') || pw.length < 8) return reply({ error: 'Enter your Apple ID email and the app-specific password.' }, 400);
    try {
      const cal = await appleDiscover(appleId, pw, b.calendar_name ? String(b.calendar_name) : undefined);
      const old = await db.from('calendar_connections').select('secret_id').eq('provider', 'apple').eq('account', appleId).maybeSingle();
      const secretId = await db.rpc('store_calendar_secret', { p_name: `apple:${appleId}`, p_secret: JSON.stringify({ user: appleId, pass: pw }) });
      if (secretId.error) throw new Error('Could not store the password securely.');
      if (old.data) await db.rpc('delete_calendar_secret', { p_id: old.data.secret_id }); // replace, don't pile up old secrets
      const { error } = await db.from('calendar_connections').upsert(
        { provider: 'apple', account: appleId, secret_id: secretId.data, calendar_ref: cal.ref, status: 'ok', last_error: null }, { onConflict: 'provider,account' });
      if (error) throw new Error(error.message);
      fetch(`${URL_}/functions/v1/calendar-push`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }).catch(() => {});
      return reply({ ok: true, calendar: cal.name });
    } catch (e) { return reply({ error: (e as Error).message }, 400); }
  }

  if (b.action === 'disconnect') {
    const { data: c } = await db.from('calendar_connections').select('id, secret_id').eq('id', Number(b.id)).maybeSingle();
    if (!c) return reply({ error: 'Not found.' }, 404);
    await db.rpc('delete_calendar_secret', { p_id: c.secret_id });
    await db.from('calendar_connections').delete().eq('id', c.id);
    return reply({ ok: true });
  }

  if (b.action === 'sync') {
    const r = await fetch(`${URL_}/functions/v1/calendar-push`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } });
    return reply(await r.json().catch(() => ({ ok: r.ok })), r.ok ? 200 : 502);
  }

  return reply({ error: 'Unknown action.' }, 400);
});
