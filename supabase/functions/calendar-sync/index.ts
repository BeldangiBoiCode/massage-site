// Pulls busy times from Nikesh's Google/Apple calendars (ICS links in calendar_sources)
// into external_busy. Called every 15 min by pg_cron. verify_jwt = false; auth is app_settings.cron_secret.
// Only start/end times are kept, never event titles.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import ICAL from 'npm:ical.js@2.1.0';

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const DAYS_AHEAD = 90;
const MAX_PER_EVENT = 400;

function busyFrom(icsText: string, from: Date, to: Date) {
  const out: { starts_at: string; ends_at: string }[] = [];
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent);
    if (vevent.getFirstPropertyValue('transp') === 'TRANSPARENT') continue; // marked "free"
    if (vevent.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const push = (s: ICAL.Time, e: ICAL.Time) => {
      const a = s.toJSDate(), b = e.toJSDate();
      if (b > from && a < to && b > a) out.push({ starts_at: a.toISOString(), ends_at: b.toISOString() });
    };
    if (ev.isRecurring()) {
      const it = ev.iterator();
      for (let n = 0, next; (next = it.next()) && n < MAX_PER_EVENT; n++) {
        if (next.toJSDate() > to) break;
        const d = ev.getOccurrenceDetails(next);
        push(d.startDate, d.endDate);
      }
    } else if (ev.startDate && ev.endDate) {
      push(ev.startDate, ev.endDate);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const { data: tok } = await db.from('app_settings').select('value').eq('key', 'cron_secret').single();
  if (!tok || req.headers.get('Authorization') !== `Bearer ${tok.value}`) return new Response('Unauthorized', { status: 401 });

  const from = new Date(Date.now() - 24 * 3600 * 1000);
  const to = new Date(Date.now() + DAYS_AHEAD * 24 * 3600 * 1000);
  const { data: sources, error } = await db.from('calendar_sources').select('id, ics_url').eq('enabled', true);
  if (error) return new Response(error.message, { status: 500 });

  const report: Record<string, string | number> = {};
  for (const s of sources ?? []) {
    try {
      const r = await fetch(s.ics_url.replace(/^webcal:/, 'https:'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = busyFrom(await r.text(), from, to).map((b) => ({ ...b, source_id: s.id }));
      // Replace this source's rows only after a successful parse.
      await db.from('external_busy').delete().eq('source_id', s.id);
      if (rows.length) {
        const { error: e } = await db.from('external_busy').insert(rows);
        if (e) throw e;
      }
      await db.from('calendar_sources').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', s.id);
      report[s.id] = rows.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('calendar_sources').update({ last_error: msg.slice(0, 500) }).eq('id', s.id);
      report[s.id] = `error: ${msg}`;
    }
  }
  return Response.json({ sources: sources?.length ?? 0, report });
});
