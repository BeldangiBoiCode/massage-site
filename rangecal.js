// Month calendar for picking one day or a range of days (time off, breaks, staff bookings).
// Writes ISO dates ("2026-10-19") into the given inputs, so the forms keep working as before.
//   mountRangeCal(el, { startInput, endInput, mode: 'range' | 'single', marked: Set, blocked: (iso) => bool, onChange })
// range mode: tap a day, then tap another to stretch it; tapping the same day twice keeps one day.
function mountRangeCal(root, { startInput, endInput, mode = 'range', marked = new Set(), blocked = () => false, onChange } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pretty = (s, long) => new Date(`${s}T12:00`).toLocaleDateString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  const todayIso = iso(new Date());
  let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
  let start = startInput?.value || '', end = endInput?.value || start, picking = false;
  root.classList.add('cal', 'rcal');

  function emit() {
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end && end !== start ? end : '';
    onChange?.({ start, end: end || start });
  }
  function summary() {
    if (!start) return mode === 'single' ? 'Pick a day.' : 'Tap a day. Tap a second day to make it a range.';
    if (mode === 'single' || end === start) return picking ? `${pretty(start, true)}. Tap another day for a range, or the same day again to keep one.` : pretty(start, true);
    const n = Math.round((new Date(`${end}T12:00`) - new Date(`${start}T12:00`)) / 864e5) + 1;
    return `${pretty(start)} to ${pretty(end)} (${n} days)`;
  }
  function draw() {
    const first = new Date(view.y, view.m, 1), gridStart = new Date(view.y, view.m, 1 - first.getDay());
    const atStart = view.y === new Date().getFullYear() && view.m === new Date().getMonth();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i), s = iso(d);
      if (d.getMonth() !== view.m) { cells += '<span class="day blank"></span>'; continue; }
      const past = s < todayIso, bl = blocked(s);
      const inRange = start && s >= start && s <= (end || start);
      const cls = ['day', s === todayIso ? 'today' : '', marked.has(s) ? 'off' : '', inRange ? 'in-range' : '', s === start || s === end ? 'edge' : ''].filter(Boolean).join(' ');
      cells += `<button type="button" class="${cls}" data-date="${s}" ${past || bl ? 'disabled' : ''} aria-pressed="${!!inRange}" aria-label="${pretty(s, true)}${marked.has(s) ? ', already blocked' : ''}">${d.getDate()}</button>`;
    }
    root.innerHTML = `<div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month" ${atStart ? 'disabled' : ''}>‹</button>
        <b>${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button></div>
      <div class="cal-week" aria-hidden="true">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span>${n}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <p class="rcal-sum" aria-live="polite">${summary()}</p>
      ${marked.size ? '<p class="rcal-key"><i></i> already blocked</p>' : ''}`;
  }
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { const n = new Date(view.y, view.m + Number(nav.dataset.nav), 1); view = { y: n.getFullYear(), m: n.getMonth() }; return draw(); }
    const day = e.target.closest('.day[data-date]');
    if (!day || day.disabled) return;
    const s = day.dataset.date;
    if (mode === 'single') { start = end = s; picking = false; }
    else if (!picking) { start = end = s; picking = true; }
    else { [start, end] = s < start ? [s, start] : [start, s]; picking = false; }
    emit(); draw();
  });
  draw();
  return {
    clear() { start = end = ''; picking = false; emit(); draw(); },
    setMarked(set) { marked = set; draw(); },
    setBlocked(fn) { blocked = fn; draw(); },
    refresh: draw,
  };
}
