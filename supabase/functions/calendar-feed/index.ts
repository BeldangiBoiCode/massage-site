// Calendar subscription feed Nikesh adds to Google/Apple Calendar:
//   https://<ref>.supabase.co/functions/v1/calendar-feed?token=<feed_token>
// Full details (name, phone, email, add-ons, notes) go into the event so Nikesh sees everything in his calendar app.
// The link is secret (token); rotate it by updating app_settings.feed_token. Never share it.
// Token = app_settings.feed_token (rotate by updating that row). verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const { data: row } = await db.from('app_settings').select('value').eq('key', 'feed_token').single();
  if (!row || token !== row.value) return new Response('Not found', { status: 404 });

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: appts, error } = await db
    .from('appointments')
    .select('id, client_name, client_phone, client_email, service, addons, price, tip, therapist_notes, starts_at, duration_min, status, created_at')
    .gte('starts_at', since)
    .order('starts_at');
  if (error) return new Response(error.message, { status: 500 });

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Namaste Nirvana//Appointments//EN',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Namaste Nirvana appointments', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const a of appts ?? []) {
    const start = new Date(a.starts_at);
    const end = new Date(start.getTime() + a.duration_min * 60000);
    const first = a.client_name.trim().split(/\s+/)[0];
    const detail = [a.client_name, a.client_phone, a.client_email, `${a.duration_min} min ${a.service}`, a.addons?.length ? `Add-ons: ${a.addons.join(', ')}` : '', a.price != null ? `Price: $${a.price}` : '', a.tip > 0 ? `Tip: $${a.tip}` : '', a.therapist_notes ? `Notes: ${a.therapist_notes}` : ''].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:appt-${a.id}@namaste-nirvana`,
      `DTSTAMP:${stamp(new Date(a.created_at))}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${a.service} - ${first}`)}`,
      `DESCRIPTION:${esc(detail)}`,
      'LOCATION:23 Logwood St\\, South Burlington\\, VT',
      `STATUS:${a.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
