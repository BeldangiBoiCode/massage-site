// Booking form: sends to the `submit-booking` edge function. Signed-in users get it linked to their profile.
const form = document.getElementById('booking');
const status = document.getElementById('status');
const button = form.querySelector('button[type=submit]');
const buttonLabel = button.querySelector('.btn-label');
const calEl = document.getElementById('cal');
const slotsEl = document.getElementById('slots');
const slotHint = document.getElementById('slot-hint');

// Hours: Sun + Mon, 9am to 8pm, 20 min break between sessions. Mirrors slot_problem() in Supabase.
const OPEN = 9 * 60, CLOSE = 20 * 60, BREAK = 20, STEP = 30; // starts on :00 or :30 only; break is hidden
const OPEN_DAYS = [0, 1];
const MAX_DAYS_AHEAD = 60;
const PRICES = { 60: 85, 90: 120 };
const ADDON_PRICES = { 'Cupping': 15, 'TENS machine': 20 };
const TZ = 'America/New_York';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const label = (m) => {
  const h = Math.floor(m / 60), mm = pad(m % 60);
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
};
const prettyDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// Hidden spam trap (people never see or fill it; bots do).
form.insertAdjacentHTML('beforeend',
  '<input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">');

/* ---------- Calendar: closed days can't be picked ---------- */
const today = new Date();
const lastBookable = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS_AHEAD);
let view = { y: today.getFullYear(), m: today.getMonth() };

function renderCalendar() {
  const first = new Date(view.y, view.m, 1);
  const lead = first.getDay();
  const count = new Date(view.y, view.m + 1, 0).getDate();
  const todayIso = localDate(today), lastIso = localDate(lastBookable);
  const atStart = view.y === today.getFullYear() && view.m === today.getMonth();
  const atEnd = new Date(view.y, view.m + 1, 1) > lastBookable;

  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="day blank"></span>';
  for (let d = 1; d <= count; d++) {
    const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
    const open = OPEN_DAYS.includes((lead + d - 1) % 7) && iso >= todayIso && iso <= lastIso;
    const cls = ['day', iso === todayIso ? 'today' : '', iso === form.date.value ? 'selected' : ''].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-date="${iso}" ${open ? '' : 'disabled'} aria-pressed="${iso === form.date.value}"
      aria-label="${prettyDay(iso)}${open ? '' : ', closed'}">${d}</button>`;
  }
  calEl.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month" ${atStart ? 'disabled' : ''}>‹</button>
      <b>${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
      <button type="button" class="cal-nav" data-nav="1" aria-label="Next month" ${atEnd ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-week" aria-hidden="true">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>`;
}

calEl.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const next = new Date(view.y, view.m + Number(nav.dataset.nav), 1);
    view = { y: next.getFullYear(), m: next.getMonth() };
    return renderCalendar();
  }
  const day = e.target.closest('.day[data-date]');
  if (!day || day.disabled) return;
  form.date.value = day.dataset.date;
  renderCalendar();
  loadSlots();
});

/* ---------- Time chips (skeleton while loading) ---------- */
function showMessage(text) { slotsEl.innerHTML = `<p class="slots-msg">${text}</p>`; }
function showSkeleton() {
  slotsEl.innerHTML = Array.from({ length: 8 }, () => '<span class="skeleton chip-skeleton"></span>').join('');
  slotsEl.setAttribute('aria-busy', 'true');
}

let slotRequest = 0;
async function loadSlots() {
  const day = form.date.value;
  const dur = Number(form.duration.value);
  form.time.value = '';
  slotHint.textContent = 'Sessions run 9am to 8pm, with a short break between clients.';
  slotsEl.removeAttribute('aria-busy');
  if (!day) return showMessage('Pick a day to see open times.');
  showSkeleton();
  const req = ++slotRequest;

  let busy = [];
  try {
    const { data, error } = await sb.rpc('busy_slots', { d: day });
    if (!error && data) busy = data;
  } catch { /* Supabase not reachable: show all times, the server check still guards the booking. */ }
  if (req !== slotRequest) return;
  slotsEl.removeAttribute('aria-busy');

  const now = new Date();
  const earliest = day === localDate(now) ? now.getHours() * 60 + now.getMinutes() + 120 : 0; // 2h notice
  const chips = [];
  for (let s = OPEN; s + dur <= CLOSE; s += STEP) {
    if (s <= earliest) continue;
    const clash = busy.some((b) => {
      const bs = toMin(b.start_time);
      const gap = b.buffer_min ?? BREAK; // 20 min after sessions; 0 for time off and calendar events
      return s < bs + b.duration_min + gap && bs < s + dur + gap;
    });
    if (!clash) chips.push(s);
  }
  if (!chips.length) return showMessage('Fully booked that day. Try another one.');
  slotsEl.innerHTML = chips.map((s) =>
    `<button type="button" class="chip" role="radio" aria-checked="false" data-start="${toTime(s)}">${label(s)}</button>`).join('');
}

slotsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  slotsEl.querySelectorAll('.chip').forEach((c) => { c.classList.toggle('on', c === chip); c.setAttribute('aria-checked', c === chip); });
  form.time.value = chip.dataset.start;
  const start = toMin(chip.dataset.start);
  slotHint.textContent = `${label(start)} to ${label(start + Number(form.duration.value))}`;
});

form.duration.addEventListener('change', loadSlots);

/* ---------- Prefill from the profile when signed in ---------- */
currentUser().then(async (u) => {
  if (!u) return;
  const { data: p } = await sb.from('profiles').select('full_name, phone, email').eq('id', u.id).single();
  if (!p) return;
  if (!form.name.value) form.name.value = p.full_name ?? '';
  if (!form.phone.value) form.phone.value = p.phone ?? '';
  if (!form.email.value) form.email.value = p.email ?? u.email ?? '';
});

/* ---------- Confirmation card + calendar file ---------- */
const done = document.createElement('div');
done.className = 'done';
done.hidden = true;
form.after(done);

// "2026-10-19" + "10:00" in shop time -> a real Date.
function shopTime(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return new Date(guess - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess));
}

function calendarFile(b) {
  const start = shopTime(b.date, b.time);
  const end = new Date(start.getTime() + b.duration * 60000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Namaste Nirvana//Booking//EN', 'BEGIN:VEVENT',
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@namaste-nirvana`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${b.duration} min ${b.service} massage`,
    'LOCATION:23 Logwood St\\, South Burlington\\, VT 05403', 'DESCRIPTION:Namaste Nirvana Massage with Nikesh. Questions? (802) 373-9672',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
}

const esc2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showDone(b, confirmed) {
  const total = PRICES[b.duration] + b.addons.reduce((n, a) => n + (ADDON_PRICES[a] ?? 0), 0);
  const href = confirmed ? calendarFile(b) : '';
  done.innerHTML = `
    <svg class="done-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg>
    <h3>${confirmed ? 'You\'re booked' : 'Request received'}</h3>
    <p class="done-lead">${confirmed
      ? `See you ${esc2(prettyDay(b.date))}.${b.email ? ' A confirmation is on its way to your email.' : ''}`
      : `We'll text ${esc2(b.phone)} to confirm.`}</p>
    <dl class="done-sum">
      <div><dt>When</dt><dd>${esc2(prettyDay(b.date))}, ${label(toMin(b.time))}</dd></div>
      <div><dt>Massage</dt><dd>${b.duration} min ${esc2(b.service)}</dd></div>
      ${b.addons.length ? `<div><dt>Add-ons</dt><dd>${esc2(b.addons.join(', '))}</dd></div>` : ''}
      <div><dt>Total</dt><dd>$${total}, paid at the studio</dd></div>
      <div><dt>Where</dt><dd>23 Logwood St, South Burlington</dd></div>
    </dl>
    <div class="done-actions">
      ${confirmed ? `<a class="btn" href="${href}" download="namaste-nirvana-massage.ics">Add to calendar</a>` : ''}
      <button class="btn ghost" type="button" data-again>Book another</button>
    </div>`;
  form.hidden = true;
  done.hidden = false;
  done.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

done.addEventListener('click', (e) => {
  if (!e.target.closest('[data-again]')) return;
  done.hidden = true;
  form.hidden = false;
  form.reset();
  form.date.value = '';
  renderCalendar();
  loadSlots();
});

/* ---------- Submit ---------- */
function setBusy(on) {
  button.disabled = on;
  button.classList.toggle('loading', on);
  buttonLabel.textContent = on ? 'Booking' : 'Book this time';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const missing = ['name', 'phone', 'date', 'time'].filter((f) => !form[f].value.trim());
  if (missing.length) {
    status.className = 'status error';
    status.textContent = !form.date.value ? 'Pick a day first.' : !form.time.value ? 'Pick a time.' : 'Add your name and phone so we can confirm your spot.';
    (form[missing[0]].type === 'hidden' ? (missing[0] === 'date' ? calEl : slotsEl) : form[missing[0]]).scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (form[missing[0]].type !== 'hidden') form[missing[0]].focus();
    return;
  }
  status.className = 'status';
  status.textContent = '';
  setBusy(true);
  const addons = [...form.querySelectorAll('input[name=addon]:checked')].map((c) => c.value);
  const booking = {
    name: form.name.value, phone: form.phone.value, email: form.email.value.trim(),
    service: form.service.value, duration: Number(form.duration.value),
    date: form.date.value, time: form.time.value, addons,
  };

  // Goes through the submit-booking edge function: input check, spam/rate limit, then auto-confirm.
  let res, out = {};
  try {
    const { data: s } = await sb.auth.getSession();
    res = await fetch(`${SUPABASE_URL}/functions/v1/submit-booking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${s.session?.access_token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ ...booking, notes: form.notes.value, website: form.website.value }),
    });
    out = await res.json().catch(() => ({}));
  } catch { /* network down: handled below */ }
  setBusy(false);

  if (!res || !res.ok) {
    status.className = 'status error';
    status.textContent = out.message ?? out.error ?? 'That didn\'t go through. Call or text (802) 373-9672 and we\'ll book you by phone.';
    if (res && res.status === 409) loadSlots();
    return;
  }
  showDone(booking, out.status === 'confirmed');
});

/* ---------- Page polish: reveal on scroll, hide the floating button at the form ---------- */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduced && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll('.head, .price-menu li, .service, .addons, .steps li, .about, .visit-info, #booking');
  targets.forEach((el) => el.classList.add('will-reveal'));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  targets.forEach((el) => io.observe(el));
}

const floating = document.querySelector('.mobile-book');
if (floating && 'IntersectionObserver' in window) {
  new IntersectionObserver(([en]) => floating.classList.toggle('away', en.isIntersecting), { threshold: 0.15 })
    .observe(document.getElementById('book'));
}

renderCalendar();
showMessage('Pick a day to see open times.');
