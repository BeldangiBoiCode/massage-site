// Writes every appointment into the owner's connected calendars (Google via API, Apple via CalDAV) and keeps them in step:
// new -> created, changed -> updated, cancelled -> removed. Runs from cron every 5 minutes and from "Sync now".
// Auth: the cron secret, the service role key, or the owner's own signed-in token. verify_jwt = false.
// Secrets needed for Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const TZ = 'America/New_York';

type Appt = { id: number; client_name: string; client_phone: string | null; client_email: string | null; service: string; addons: string[] | null;
  price: number | null; tip: number | null; therapist_notes: string | null; starts_at: string; duration_min: number; status: string };
type Conn = { id: number; provider: 'google' | 'apple'; account: string; secret_id: string; calendar_ref: string };

const title = (a: Appt) => `${a.service} - ${a.client_name}`;
const details = (a: Appt) => [a.client_name, a.client_phone, a.client_email, `${a.duration_min} min ${a.service}`,
  a.addons?.length ? `Add-ons: ${a.addons.join(', ')}` : '', a.price != null ? `Price: $${a.price}` : '', Number(a.tip) > 0 ? `Tip: $${a.tip}` : '',
  a.therapist_notes ? `Notes: ${a.therapist_notes}` : ''].filter(Boolean).join('\n');
const endOf = (a: Appt) => new Date(new Date(a.starts_at).getTime() + a.duration_min * 60000);
const hashOf = (a: Appt) => JSON.stringify([title(a), details(a), a.starts_at, a.duration_min]);

async function authorized(req: Request): Promise<boolean> {
  const tok = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!tok) return false;
  if (tok === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true;
  const { data: s } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  if (s && tok === s.value) return true;
  const { data: u } = await db.auth.getUser(tok);
  if (!u.user) return false;
  const { data: a } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  return !!a;
}

/* ---------- Google ---------- */
async function googleToken(refresh: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '', refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google sign-in expired. Reconnect Google in Settings.');
  return j.access_token;
}
function googleEvent(a: Appt) {
  return { summary: title(a), description: details(a), location: '23 Logwood St, South Burlington, VT 05403',
    start: { dateTime: new Date(a.starts_at).toISOString(), timeZone: TZ }, end: { dateTime: endOf(a).toISOString(), timeZone: TZ } };
}
async function pushGoogle(c: Conn, appts: Appt[], map: Map<number, { remote_id: string; synced_hash: string | null }>) {
  const secret = await db.rpc('read_calendar_secret', { p_id: c.secret_id });
  const token = await googleToken(secret.data);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_ref)}/events`;
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const a of appts) {
    const m = map.get(a.id), hash = hashOf(a);
    if (a.status === 'cancelled' || a.status === 'no_show') {
      if (m) { await fetch(`${base}/${m.remote_id}`, { method: 'DELETE', headers: h }); await drop(c.id, a.id); }
      continue;
    }
    if (!m) {
      const r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify(googleEvent(a)) });
      if (!r.ok) throw new Error(`Google: ${(await r.json()).error?.message ?? r.status}`);
      await remember(c.id, a.id, (await r.json()).id, hash);
    } else if (m.synced_hash !== hash) {
      const r = await fetch(`${base}/${m.remote_id}`, { method: 'PUT', headers: h, body: JSON.stringify(googleEvent(a)) });
      if (r.ok) await remember(c.id, a.id, m.remote_id, hash);
      else if (r.status === 404 || r.status === 410) await drop(c.id, a.id); // deleted by hand: recreate next run
    }
  }
}

/* ---------- Apple (CalDAV) ---------- */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ics = (a: Appt) => {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Namaste Nirvana//Appointments//EN', 'BEGIN:VEVENT', `UID:appt-${a.id}@namaste-nirvana`,
    `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(new Date(a.starts_at))}`, `DTEND:${stamp(endOf(a))}`, `SUMMARY:${esc(title(a))}`,
    `DESCRIPTION:${esc(details(a))}`, 'LOCATION:23 Logwood St\\, South Burlington\\, VT 05403', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
};
async function pushApple(c: Conn, appts: Appt[], map: Map<number, { remote_id: string; synced_hash: string | null }>) {
  const secret = JSON.parse((await db.rpc('read_calendar_secret', { p_id: c.secret_id })).data);
  const auth = 'Basic ' + btoa(`${secret.user}:${secret.pass}`);
  for (const a of appts) {
    const m = map.get(a.id), hash = hashOf(a), url = `${c.calendar_ref}appt-${a.id}.ics`;
    if (a.status === 'cancelled' || a.status === 'no_show') {
      if (m) { await fetch(url, { method: 'DELETE', headers: { Authorization: auth } }); await drop(c.id, a.id); }
      continue;
    }
    if (m && m.synced_hash === hash) continue;
    const r = await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'text/calendar; charset=utf-8' }, body: ics(a) });
    if (r.status === 401) throw new Error('Apple rejected the password. Reconnect Apple in Settings.');
    if (!r.ok) throw new Error(`Apple: ${r.status}`);
    await remember(c.id, a.id, `appt-${a.id}.ics`, hash);
  }
}

const remember = (conn: number, appt: number, remote: string, hash: string) =>
  db.from('calendar_events').upsert({ connection_id: conn, appointment_id: appt, remote_id: remote, synced_hash: hash });
const drop = (conn: number, appt: number) => db.from('calendar_events').delete().eq('connection_id', conn).eq('appointment_id', appt);

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response('Not allowed', { status: 401 });
  const { data: conns } = await db.from('calendar_connections').select('*');
  if (!conns?.length) return Response.json({ ok: true, connections: 0 });

  const since = new Date(Date.now() - 2 * 86400e3).toISOString();
  const { data: appts } = await db.from('appointments')
    .select('id, client_name, client_phone, client_email, service, addons, price, tip, therapist_notes, starts_at, duration_min, status')
    .gte('starts_at', since).order('starts_at').limit(500);

  const results: Record<string, string> = {};
  for (const c of conns as Conn[]) {
    try {
      const { data: ev } = await db.from('calendar_events').select('appointment_id, remote_id, synced_hash').eq('connection_id', c.id);
      const map = new Map((ev ?? []).map((e) => [e.appointment_id as number, e]));
      if (c.provider === 'google') await pushGoogle(c, (appts ?? []) as Appt[], map); else await pushApple(c, (appts ?? []) as Appt[], map);
      await db.from('calendar_connections').update({ last_synced_at: new Date().toISOString(), last_error: null, status: 'ok' }).eq('id', c.id);
      results[`${c.provider}:${c.account}`] = 'ok';
    } catch (e) {
      const msg = (e as Error).message;
      await db.from('calendar_connections').update({ last_error: msg.slice(0, 300), status: 'error' }).eq('id', c.id);
      results[`${c.provider}:${c.account}`] = msg;
    }
  }
  return Response.json({ ok: true, results });
});
