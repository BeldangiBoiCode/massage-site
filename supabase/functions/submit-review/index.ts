// Public review form -> reviews table (status 'pending' until Nikesh approves it on the admin page).
// Validates input, blocks links/spam, rate-limits by IP. verify_jwt = false (public form).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

const SERVICES = ['Deep tissue', 'Swedish relaxation', 'Sports and recovery'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, ...extra } });

// Rate limiting lives here so Redis can replace it later without touching the rest.
async function rateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_max: max, p_window_secs: windowSecs });
  return error ? true : data === true;
}

const clean = (s: unknown, max: number) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  // Loose limit on every request (typos and retries are fine); the strict per-day limit comes after validation.
  if (!(await rateLimit(`review-hit:${ip}`, 40, 3600)) || !(await rateLimit('review-global', 200, 3600))) {
    return reply({ error: 'Too many tries. Please wait a little and try again.' }, 429, { 'Retry-After': '3600' });
  }

  const raw = await req.text();
  if (raw.length > 8_000) return reply({ error: 'That review is too long.' }, 413);
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return reply({ error: 'Invalid request.' }, 400); }

  // Honeypot: real people never fill the hidden "website" field. Pretend it worked.
  if (clean(b.website, 50)) return reply({ ok: true, message: 'Thank you for your review!' });

  const name = clean(b.name, 60);
  const body = clean(b.body, 1500).replace(/\n{3,}/g, '\n\n');
  const rating = Number(b.rating);
  const service = clean(b.service, 60);
  const errors: string[] = [];
  if (!name) errors.push('Please add your name.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('Pick a star rating from 1 to 5.');
  if (body.length < 10) errors.push('Please write a little more (at least 10 characters).');
  if (service && !SERVICES.includes(service)) errors.push('Pick a massage type from the list.');
  if (/https?:\/\/|www\.|\.com\b|<[a-z!\/]/i.test(`${name} ${body}`)) errors.push('Please leave out links and web addresses.');
  if (errors.length) return reply({ error: errors[0], errors }, 400);
  if (!(await rateLimit(`review-ip:${ip}`, 3, 86400))) {
    return reply({ error: 'You\'ve sent a few reviews already today. Thank you! Please try again tomorrow.' }, 429, { 'Retry-After': '86400' });
  }

  let userId: string | null = null;
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (jwt) {
    const { data } = await db.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  const { error } = await db.from('reviews').insert({ user_id: userId, name, rating, body, service: service || null });
  if (error) return reply({ error: 'Could not save your review. Please try again.' }, 500);
  return reply({ ok: true, message: 'Thank you! Your review will appear once Nikesh has read it.' });
});
