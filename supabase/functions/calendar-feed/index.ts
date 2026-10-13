// Calendar subscription feed Nikesh adds to Google/Apple Calendar:
//   https://<ref>.supabase.co/functions/v1/calendar-feed?token=<feed_token>
// Privacy: only first name, service and time. No phone, email or notes ever leave the database here.
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
    .select('id, client_name, service, starts_at, duration_min, status, created_at')
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
    lines.push(
      'BEGIN:VEVENT',
      `UID:appt-${a.id}@namaste-nirvana`,
      `DTSTAMP:${stamp(new Date(a.created_at))}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${a.service} - ${first}`)}`,
      'DESCRIPTION:Details are in the admin page.',
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
