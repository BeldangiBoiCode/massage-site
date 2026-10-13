// The only way the website creates a booking. Validates input, rate-limits by IP (and phone),
// stores the request, then asks process-bookings to confirm it and returns the outcome.
// verify_jwt = false (public form); abuse is handled by the rate limits below.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

const SERVICES = ['Deep tissue', 'Swedish relaxation', 'Sports and recovery'];
const DURATIONS = [60, 90];
const ADDONS = ['Cupping', 'TENS machine'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, ...extra } });

// Rate limiting lives here so Redis can replace it later without touching the rest.
// Returns true when the caller is within the limit.
async function rateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_max: max, p_window_secs: windowSecs });
  return error ? true : data === true; // if the limiter itself fails, don't block real customers
}

const clean = (s: unknown, max: number) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function validate(b: Record<string, unknown>) {
  const errors: string[] = [];
  const name = clean(b.name, 120);
  const phone = clean(b.phone, 30);
  const digits = phone.replace(/\D/g, '');
  const email = clean(b.email, 200);
  const service = clean(b.service, 60);
  const duration = Number(b.duration);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const notes = clean(b.notes, 1000);

  if (!name) errors.push('Please add your name.');
  if (digits.length < 7 || digits.length > 15) errors.push('Please add a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('That email doesn\'t look right.');
  if (!SERVICES.includes(service)) errors.push('Pick a massage type.');
  if (!DURATIONS.includes(duration)) errors.push('Pick a length.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.push('Pick a date.');
  if (!/^([01]\d|2[0-3]):(00|30)$/.test(time)) errors.push('Pick a start time on the hour or half hour.');
  const addons = [...new Set(Array.isArray(b.addons) ? b.addons.map((a) => clean(a, 30)) : [])];
  if (addons.some((a) => !ADDONS.includes(a))) errors.push('Unknown add-on.');
  // Shown to Nikesh on the admin page, so add-ons are written into the notes too.
  const fullNotes = [addons.length ? `Add-ons: ${addons.join(', ')}` : '', notes].filter(Boolean).join('\n');
  return { errors, value: { name, phone, email: email || null, service, duration, date, time, addons, notes: fullNotes || null }, digits };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (!(await rateLimit(`ip:${ip}`, 5, 3600)) || !(await rateLimit('global', 300, 3600))) {
    return reply({ error: 'Too many requests. Please try again later or call (802) 373-9672.' }, 429, { 'Retry-After': '3600' });
  }

  const raw = await req.text();
  if (raw.length > 10_000) return reply({ error: 'Request too large.' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid request.' }, 400); }

  // Honeypot: real people never fill the hidden "website" field. Pretend it worked.
  if (clean(body.website, 50)) return reply({ status: 'confirmed', message: 'Thanks!' });

  const { errors, value: v, digits } = validate(body);
  if (errors.length) return reply({ error: errors[0], errors }, 400);
  if (!(await rateLimit(`phone:${digits}`, 3, 86400))) {
    return reply({ error: 'That phone number has made several requests today. Please call (802) 373-9672.' }, 429);
  }

  // Link the request to the signed-in user, if any. An anon-key bearer simply yields no user.
  let userId: string | null = null;
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (jwt) {
    const { data } = await db.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  const { data: row, error } = await db.from('booking_requests').insert({
    user_id: userId, name: v.name, phone: v.phone, email: v.email, service: v.service,
    duration_min: v.duration, preferred_date: v.date, preferred_time: v.time, addons: v.addons, notes: v.notes,
  }).select('id').single();
  if (error || !row) return reply({ error: 'Could not save your request. Please call (802) 373-9672.' }, 500);

  // Confirm it now rather than waiting for the cron safety net.
  const { data: tok } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  if (tok) {
    await fetch(`${SUPABASE_URL}/functions/v1/process-bookings`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.value}`, 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
  }

  const { data: res } = await db.from('booking_requests').select('status, decline_reason').eq('id', row.id).single();
  if (res?.status === 'confirmed') return reply({ status: 'confirmed', message: 'You\'re booked!' });
  if (res?.status === 'declined') return reply({ status: 'declined', message: res.decline_reason ?? 'That time isn\'t available.' }, 409);
  return reply({ status: 'received', message: 'Request received. We\'ll confirm shortly.' }, 202);
});
