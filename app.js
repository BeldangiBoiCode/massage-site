// Booking form: saves to Supabase `booking_requests`. Signed-in users get it linked to their profile.
const form = document.getElementById('booking');
const status = document.getElementById('status');
const button = form.querySelector('button');

// Hours: Sun + Mon, 9am to 8pm, 20 min break between sessions. Mirrors check_booking_slot() in Supabase.
const OPEN = 9 * 60, CLOSE = 20 * 60, BREAK = 20, STEP = 20;
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
      return s < bs + b.duration_min + BREAK && bs < s + dur + BREAK;
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
  const notes = [addons.length ? `Add-ons: ${addons.join(', ')}` : '', form.notes.value.trim()].filter(Boolean).join('\n');
  const when = `${new Date(`${form.date.value}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${label(toMin(form.time.value))}`;
  const { error } = await sb.from('booking_requests').insert({
    user_id: user?.id ?? null,
    name: form.name.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim() || null,
    service: form.service.value,
    duration_min: Number(form.duration.value),
    preferred_date: form.date.value,
    preferred_time: form.time.value,
    notes: notes || null,
  });
  button.disabled = false;
  if (error) {
    status.className = 'status error';
    // Slot rules from check_booking_slot() come back as readable messages.
    status.textContent = /taken|Sunday|9am|Pick a time/.test(error.message)
      ? error.message
      : 'That didn\'t go through. Call or text (802) 373-9672 and we\'ll book you by phone.';
    loadSlots();
    return;
  }
  status.className = 'status';
  status.textContent = `Requested for ${when}. We'll text ${form.phone.value} to confirm.`;
  form.reset();
  loadSlots();
});
