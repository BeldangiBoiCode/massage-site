// Booking form: sends to the `submit-booking` edge function. Signed-in users get it linked to their profile.
const form = document.getElementById('booking');
const status = document.getElementById('status');
const button = form.querySelector('button');

// Hours: Sun + Mon, 9am to 8pm, 20 min break between sessions. Mirrors check_booking_slot() in Supabase.
const OPEN = 9 * 60, CLOSE = 20 * 60, BREAK = 20, STEP = 30; // starts on :00 or :30 only; break is hidden
const OPEN_DAYS = [0, 1];

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const label = (m) => {
  const h = Math.floor(m / 60), mm = pad(m % 60);
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
};

form.date.min = localDate(new Date());

// Hidden spam trap (people never see or fill it; bots do). Added here so index.html stays untouched.
form.insertAdjacentHTML('beforeend',
  '<input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">');

function setTimeOptions(options, enabled) {
  form.time.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  form.time.disabled = !enabled;
}

let slotRequest = 0;
async function loadSlots() {
  const day = form.date.value;
  const dur = Number(form.duration.value);
  if (!day) return setTimeOptions([['', 'Pick a day first']], false);
  if (!OPEN_DAYS.includes(new Date(`${day}T12:00`).getDay())) {
    return setTimeOptions([['', 'Closed that day. Pick a Sunday or Monday']], false);
  }
  setTimeOptions([['', 'Checking open times…']], false);
  const req = ++slotRequest;

  let busy = [];
  try {
    const { data, error } = await sb.rpc('busy_slots', { d: day });
    if (!error && data) busy = data;
  } catch { /* Supabase not reachable: show all times, the server check still guards inserts. */ }
  if (req !== slotRequest) return;

  const now = new Date();
  const earliest = day === localDate(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const open = [];
  for (let s = OPEN; s + dur <= CLOSE; s += STEP) {
    if (s <= earliest) continue;
    const clash = busy.some((b) => {
      const bs = toMin(b.start_time);
      const gap = b.buffer_min ?? BREAK; // 20 min after sessions; 0 for time off and calendar events
      return s < bs + b.duration_min + gap && bs < s + dur + gap;
    });
    if (!clash) open.push([toTime(s), `${label(s)} to ${label(s + dur)}`]);
  }
  open.length
    ? setTimeOptions([['', 'Pick a time'], ...open], true)
    : setTimeOptions([['', 'Fully booked. Try another day']], false);
}

form.date.addEventListener('change', loadSlots);
form.duration.addEventListener('change', loadSlots);

// Prefill from the profile when signed in.
currentUser().then(async (u) => {
  if (!u) return;
  const { data: p } = await sb.from('profiles').select('full_name, phone, email').eq('id', u.id).single();
  if (!p) return;
  if (!form.name.value) form.name.value = p.full_name ?? '';
  if (!form.phone.value) form.phone.value = p.phone ?? '';
  if (!form.email.value) form.email.value = p.email ?? u.email ?? '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const missing = ['name', 'phone', 'date', 'time'].filter((f) => !form[f].value.trim());
  if (missing.length) {
    status.className = 'status error';
    status.textContent = 'Add your name, phone, a day and a time so we can confirm your spot.';
    form[missing[0]].focus();
    return;
  }
  button.disabled = true;
  const user = await currentUser();
  const addons = [...form.querySelectorAll('input[name=addon]:checked')].map((c) => c.value);
  const when = `${new Date(`${form.date.value}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${label(toMin(form.time.value))}`;

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
      body: JSON.stringify({
        name: form.name.value, phone: form.phone.value, email: form.email.value,
        service: form.service.value, duration: Number(form.duration.value),
        date: form.date.value, time: form.time.value, addons, notes: form.notes.value,
        website: form.website.value, // hidden spam trap, added below
      }),
    });
    out = await res.json().catch(() => ({}));
  } catch { /* network down: handled below */ }
  button.disabled = false;

  if (!res || !res.ok) {
    status.className = 'status error';
    status.textContent = out.message ?? out.error ?? 'That didn\'t go through. Call or text (802) 373-9672 and we\'ll book you by phone.';
    loadSlots();
    return;
  }
  status.className = 'status';
  status.textContent = out.status === 'confirmed'
    ? `You're booked for ${when}.${form.email.value ? ' A confirmation is on its way.' : ''}`
    : `Requested for ${when}. We'll text ${form.phone.value} to confirm.`;
  form.reset();
  loadSlots();
});
