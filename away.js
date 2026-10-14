// Shows Nikesh's time off (with his note) as a notice bar, so everyone knows before they try to book.
// Booking itself is blocked by the database for these times. Visual only.
(async () => {
  if (typeof sb === 'undefined') return;
  const { data } = await sb.rpc('public_time_off');
  const TZ = 'America/New_York';
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toLowerCase();
  const wholeDay = (t) => hhmm(t.starts_at) === '12:00 am' && hhmm(t.ends_at) === '12:00 am';
  // Only day-sized absences get a notice; a one-hour lunch break doesn't need a banner.
  const items = (data ?? []).filter((t) => new Date(t.ends_at) - new Date(t.starts_at) >= 8 * 3600e3);
  if (!items.length) return;
  const now = Date.now();
  const line = (t) => {
    const last = new Date(new Date(t.ends_at).getTime() - 1).toISOString();
    const span = wholeDay(t) ? (day(t.starts_at) === day(last) ? day(t.starts_at) : `${day(t.starts_at)} to ${day(last)}`) : `${day(t.starts_at)}, ${hhmm(t.starts_at)} to ${day(t.ends_at)}, ${hhmm(t.ends_at)}`;
    const back = wholeDay(t) ? day(t.ends_at) : `${day(t.ends_at)} at ${hhmm(t.ends_at)}`;
    const active = new Date(t.starts_at) <= now;
    return `<p><b>${active ? 'Nikesh is away' : 'Heads up, Nikesh will be away'}${t.reason ? ': ' + esc(t.reason) : ''}.</b> ${esc(span)}. ${active ? 'Back ' + esc(back) + '.' : ''} Booking is closed for those times.</p>`;
  };
  const bar = document.createElement('div');
  bar.className = 'away-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = items.slice(0, 3).map(line).join('');
  const header = document.querySelector('.site-header');
  (header ? header.insertAdjacentElement('afterend', bar) : document.body.prepend(bar));
})();
