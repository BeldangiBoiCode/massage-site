// Runs right after someone submits a booking (called by submit-booking) and every minute from pg_cron
// when requests are waiting. Confirms or declines each new request against opening hours, existing
// appointments and Nikesh's synced calendars, then emails a confirmation if Resend is set up.
// verify_jwt = false; auth is the cron_secret row in app_settings.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const FROM_EMAIL = 'Namaste Nirvana <onboarding@resend.dev>'; // swap for your own domain once verified in Resend
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

async function sendEmail(to: string, subject: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
  });
  if (!r.ok) throw new Error(await r.text());
}

Deno.serve(async (req) => {
  const { data: tok } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  if (!tok || req.headers.get('Authorization') !== `Bearer ${tok.value}`) return new Response('Unauthorized', { status: 401 });

  const { data: results, error } = await db.rpc('process_booking_requests');
  if (error) return new Response(error.message, { status: 500 });

  let emailed = 0;
  for (const r of results ?? []) {
    if (r.out_status !== 'confirmed' || !env('RESEND_API_KEY')) continue;
    const { data: a } = await db.from('appointments')
      .select('id, client_name, client_email, service, starts_at, duration_min').eq('id', r.out_appointment_id).single();
    if (!a?.client_email) continue;
    const text = `Hi ${a.client_name}, you're booked: ${a.duration_min} min ${a.service.toLowerCase()} with Nikesh on ${when(a.starts_at)} at 23 Logwood St, South Burlington. Need to change it? Call or text (802) 373-9672.`;
    try {
      await sendEmail(a.client_email, 'Your massage is booked', text);
      await db.from('notifications').insert({ appointment_id: a.id, channel: 'email', sent_to: a.client_email, status: 'sent' });
      emailed++;
    } catch (e) {
      await db.from('notifications').insert({ appointment_id: a.id, channel: 'email', sent_to: a.client_email, status: 'failed', error: String(e).slice(0, 500) });
    }
  }
  return Response.json({ processed: results?.length ?? 0, emailed });
});
