// Google sends the owner back here after they approve calendar access. We swap the one-time code for a refresh token,
// store it encrypted (Vault), create the connection, then send the browser back to the Studio page.
// Secrets needed: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. In Google Cloud, add this exact redirect URI:
//   https://<project-ref>.supabase.co/functions/v1/google-callback      verify_jwt = false
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function sign(payload: string): Promise<string> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(data!.value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))));
}
const back = (ret: string, result: string) => Response.redirect(`${ret}${ret.includes('?') ? '&' : '?'}cal=${encodeURIComponent(result)}`, 302);

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  const [payload, sig] = (q.get('state') ?? '').split('.');
  if (!payload || !sig || (await sign(payload)) !== sig) return new Response('Invalid request.', { status: 400 });
  const st = JSON.parse(unb64(payload)) as { uid: string; ret: string; exp: number };
  if (Date.now() > st.exp) return new Response('That sign-in expired. Please try again.', { status: 400 });
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', st.uid).maybeSingle();
  if (!admin) return new Response('Not allowed.', { status: 403 });
  if (q.get('error') || !q.get('code')) return back(st.ret, 'cancelled');

  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: q.get('code')!, client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      redirect_uri: `${URL_}/functions/v1/google-callback`, grant_type: 'authorization_code',
    }),
  })).json();
  if (!tok.refresh_token) return back(st.ret, 'failed');

  const info = await (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  const email = String(info.email ?? 'google-account');
  const old = await db.from('calendar_connections').select('secret_id').eq('provider', 'google').eq('account', email).maybeSingle();
  const secret = await db.rpc('store_calendar_secret', { p_name: `google:${email}`, p_secret: tok.refresh_token });
  if (secret.error) return back(st.ret, 'failed');
  if (old.data) await db.rpc('delete_calendar_secret', { p_id: old.data.secret_id });
  const { error } = await db.from('calendar_connections').upsert(
    { provider: 'google', account: email, secret_id: secret.data, calendar_ref: 'primary', status: 'ok', last_error: null }, { onConflict: 'provider,account' });
  if (error) return back(st.ret, 'failed');
  fetch(`${URL_}/functions/v1/calendar-push`, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` } }).catch(() => {});
  return back(st.ret, 'google');
});
