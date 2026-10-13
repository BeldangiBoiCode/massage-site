// Sends a reminder for each scheduled appointment in the next 24 hours.
// Called hourly by pg_cron. Deploy with verify_jwt = false; auth is CRON_SECRET.
// Secrets: CRON_SECRET, RESEND_API_KEY (email). Optional SMS: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const FROM_EMAIL = 'Namaste Nirvana <onboarding@resend.dev>'; // swap for your own domain once verified in Resend

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

async function sendEmail(to: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: 'Your massage tomorrow', text }),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function sendSms(to: string, text: string) {
  const sid = env('TWILIO_SID');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${sid}:${env('TWILIO_TOKEN')}`) },
    body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Body: text }),
  });
  if (!r.ok) throw new Error(await r.text());
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${env('CRON_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const dayAhead = new Date(now.getTime() + 24 * 3600 * 1000);
  const { data: appts, error } = await db
    .from('appointments')
    .select('id, user_id, client_name, client_phone, client_email, service, starts_at, duration_min')
    .eq('status', 'scheduled')
    .is('reminder_sent_at', null)
    .gte('starts_at', now.toISOString())
    .lte('starts_at', dayAhead.toISOString());
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const a of appts ?? []) {
    let prefs = { email_reminders: true, sms_reminders: true };
    if (a.user_id) {
      const { data } = await db.from('profiles').select('email_reminders, sms_reminders').eq('id', a.user_id).single();
      if (data) prefs = data;
    }
    const text = `Hi ${a.client_name}, reminder: ${a.duration_min} min ${a.service.toLowerCase()} with Nikesh on ${when(a.starts_at)} at 23 Logwood St, South Burlington. Need to change it? Call or text (802) 373-9672.`;

    const jobs: [string, string, (to: string, t: string) => Promise<void>][] = [];
    if (a.client_email && prefs.email_reminders && env('RESEND_API_KEY')) jobs.push(['email', a.client_email, sendEmail]);
    if (a.client_phone && prefs.sms_reminders && env('TWILIO_SID')) jobs.push(['sms', a.client_phone, sendSms]);

    for (const [channel, to, send] of jobs) {
      try {
        await send(to, text);
        await db.from('notifications').insert({ appointment_id: a.id, channel, sent_to: to, status: 'sent' });
        sent++;
      } catch (e) {
        await db.from('notifications').insert({ appointment_id: a.id, channel, sent_to: to, status: 'failed', error: String(e) });
      }
    }
    await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', a.id);
  }

  return Response.json({ checked: appts?.length ?? 0, sent });
});
