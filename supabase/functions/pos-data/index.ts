// Admin-only: reads customers + sales from the Merchant360 POS and hands them to the admin page.
// Safety: the caller must be signed in AND be in the `admins` table (checked with the service role).
// The Merchant360 key lives only in the secret MERCHANT and never reaches the browser.
// Only a fixed list of read-only (GET) actions is allowed.
// verify_jwt = false because we check the token ourselves, so CORS preflight works.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const M360_BASE = Deno.env.get('M360_BASE_URL') ?? 'https://www.merchant360.com/api/m360/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TENDERS = ['card', 'card_present', 'ach', 'cash', 'check', 'gift_card', 'egift', 'other'];
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Turns the admin page's request into a Merchant360 GET path. Returns null if it isn't allowed.
function buildPath(body: Record<string, unknown>): string | null {
  const q = new URLSearchParams();
  switch (body.action) {
    case 'me':
      return '/me';
    case 'customers': {
      const search = String(body.search ?? '').trim().slice(0, 80);
      if (search) q.set('search', search);
      q.set('page', String(clampInt(body.page, 1, 10000, 1)));
      q.set('page_size', String(clampInt(body.page_size, 1, 100, 25)));
      return `/customers?${q}`;
    }
    case 'customer': {
      const id = String(body.id ?? '');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null; // blocks "../" tricks
      return `/customers/${id}`;
    }
    case 'transactions': {
      const { from, to, tender } = body as Record<string, string>;
      if (from) { if (!DATE.test(from)) return null; q.set('from', from); }
      if (to) { if (!DATE.test(to)) return null; q.set('to', to); }
      if (tender) { if (!TENDERS.includes(tender)) return null; q.set('tender', tender); }
      q.set('page', String(clampInt(body.page, 1, 10000, 1)));
      q.set('page_size', String(clampInt(body.page_size, 1, 100, 25)));
      return `/transactions?${q}`;
    }
    case 'summary': {
      const { from, to } = body as Record<string, string>;
      if (from) { if (!DATE.test(from)) return null; q.set('from', from); }
      if (to) { if (!DATE.test(to)) return null; q.set('to', to); }
      return `/reports/summary${q.size ? `?${q}` : ''}`;
    }
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: u } = await db.auth.getUser(jwt);
  if (!u.user) return reply({ error: 'Sign in first.' }, 401);
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!admin) return reply({ error: 'Admins only.' }, 403);

  const { data: ok } = await db.rpc('rate_limit_hit', { p_key: `pos:${u.user.id}`, p_max: 120, p_window_secs: 600 });
  if (ok === false) return reply({ error: 'Too many POS requests. Wait a few minutes.' }, 429);

  // The key is stored as the secret named MERCHANT.
  const key = Deno.env.get('MERCHANT');
  if (!key) return reply({ error: 'POS key is not set up yet.', code: 'not_configured' }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const path = buildPath(body);
  if (!path) return reply({ error: 'Bad request.' }, 400);

  let res: Response;
  try {
    res = await fetch(M360_BASE + path, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return reply({ error: 'The POS did not answer. Try again.' }, 502);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Log the real reason on the server only; the browser gets a plain message.
    console.error('merchant360', res.status, path.split('?')[0], JSON.stringify(data?.error ?? data));
    const msg = res.status === 401 ? 'The POS key was refused.'
      : res.status === 403 ? 'The POS key is missing a permission (needs customers:read and reports:read).'
      : res.status === 429 ? 'The POS is busy. Try again in a minute.'
      : 'The POS had a problem.';
    return reply({ error: msg, code: data?.error?.code ?? 'pos_error' }, res.status === 429 ? 429 : 502);
  }
  return reply(data);
});
