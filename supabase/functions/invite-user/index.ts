// Admin-only: emails an invite link to a new user (optionally making them an admin).
// The caller must be signed in AND be in the `admins` table. verify_jwt = false because we
// check the token ourselves, so CORS preflight works.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

// Where the invite link may send people. Add the real domain here when the site moves.
const ALLOWED_REDIRECTS = [/^https:\/\/beldangiboicode\.github\.io\//, /^http:\/\/localhost:\d+\//];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: u } = await db.auth.getUser(jwt);
  if (!u.user) return reply({ error: 'Sign in first.' }, 401);
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!admin) return reply({ error: 'Admins only.' }, 403);

  const { data: ok } = await db.rpc('rate_limit_hit', { p_key: `invite:${u.user.id}`, p_max: 20, p_window_secs: 3600 });
  if (ok === false) return reply({ error: 'Too many invites this hour.' }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200);
  const fullName = String(body.full_name ?? '').trim().slice(0, 120);
  const redirectTo = String(body.redirect_to ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'That email doesn\'t look right.' }, 400);
  if (!ALLOWED_REDIRECTS.some((re) => re.test(redirectTo))) return reply({ error: 'Bad redirect address.' }, 400);

  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo, data: fullName ? { full_name: fullName } : undefined,
  });
  if (error) return reply({ error: error.message }, error.status === 422 ? 409 : 400);

  if (body.make_admin === true && data.user) {
    await db.from('admins').upsert({ user_id: data.user.id });
  }
  return reply({ ok: true, email, admin: body.make_admin === true });
});
