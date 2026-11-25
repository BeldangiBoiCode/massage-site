// Booking form as one question at a time, plus the tap-the-body focus picker.
// app.js still does the real work (calendar, times, submit). This file only shows one step at a time
// and keeps the body picture in sync with the hidden focus_area checkboxes that app.js reads.
(() => {
  const form = document.getElementById('booking');
  if (!form) return;
  const steps = [...form.querySelectorAll('.bk-step')];
  const bar = document.getElementById('bk-bar');
  const count = document.getElementById('bk-count');
  const back = document.getElementById('bk-back');
  const next = document.getElementById('bk-next');
  const submit = document.getElementById('bk-submit');
  const status = document.getElementById('status');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let at = 0;

  // Shows step n, sliding in from the side we are moving toward.
  function go(n, scroll = true) {
    const dir = n >= at ? 'fwd' : 'back';
    at = Math.max(0, Math.min(steps.length - 1, n));
    steps.forEach((el, i) => {
      el.hidden = i !== at;
      el.classList.remove('from-fwd', 'from-back');
      if (i === at && !reduced) el.classList.add(`from-${dir}`);
    });
    bar.style.width = `${((at + 1) / steps.length) * 100}%`;
    count.textContent = `Step ${at + 1} of ${steps.length}`;
    back.hidden = at === 0;
    next.hidden = at === steps.length - 1;
    submit.hidden = at !== steps.length - 1;
    status.textContent = '';
    status.className = 'status';
    if (at === steps.length - 1) writeSummary();
    if (scroll) form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    steps[at].querySelector('.bk-q')?.focus({ preventScroll: true });
  }

  // One line that repeats the choices before the person books.
  function writeSummary() {
    const picked = [...form.querySelectorAll('input[name=focus_area]:checked')].map((c) => c.value);
    document.getElementById('bk-summary').textContent =
      `${form.duration.value} min ${form.service.value}${picked.length ? `, focus on ${picked.join(', ').toLowerCase()}` : ''}`;
  }

  // Only the first step needs checking here; the day and time are checked by app.js on submit.
  function stepOk() {
    if (at === 0) {
      const missing = !form.name.value.trim() ? form.name : !form.phone.value.trim() ? form.phone : null;
      if (missing) {
        status.className = 'status error';
        status.textContent = 'Add your name and phone so we can confirm your spot.';
        missing.focus();
        return false;
      }
    }
    return true;
  }

  next.addEventListener('click', () => { if (stepOk()) go(at + 1); });
  back.addEventListener('click', () => go(at - 1));
  // Enter in a text box moves on instead of submitting half a form.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && at < steps.length - 1) {
      e.preventDefault();
      next.click();
    }
  });

  /* ---------- Body picker ---------- */
  const checks = [...form.querySelectorAll('input[name=focus_area]')];
  const zones = [...form.querySelectorAll('.zone')];
  const picked = document.getElementById('bk-picked');

  // Paints the body zones and the "picked" line from the checkboxes (the single source of truth).
  function paintBody() {
    const on = new Set(checks.filter((c) => c.checked).map((c) => c.value));
    zones.forEach((z) => {
      const sel = on.has(z.dataset.area);
      z.classList.toggle('on', sel);
      z.setAttribute('aria-pressed', sel);
    });
    picked.textContent = on.size ? `Picked: ${[...on].join(', ')}` : 'Nothing picked yet';
  }

  function toggleArea(area) {
    const box = checks.find((c) => c.value === area);
    if (box) { box.checked = !box.checked; paintBody(); }
  }

  zones.forEach((z) => {
    z.addEventListener('click', () => toggleArea(z.dataset.area));
    z.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleArea(z.dataset.area); }
    });
  });

  // Front / Back switch
  const tabs = [...form.querySelectorAll('.bk-view button')];
  const body = document.getElementById('bk-body');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t); });
    body.dataset.show = t.dataset.view;
  }));
  body.dataset.show = 'front';

  // "Book another" resets the form: go back to the first question and clear the body.
  form.addEventListener('reset', () => setTimeout(() => { paintBody(); go(0, false); }, 0));

  /* ---------- Health + allergy icon picks ---------- */
  // Tapped icons (plus the "Other" text) are joined into the hidden `conditions` / `allergies` inputs,
  // which is what app.js already sends. "None" clears the rest; "Other" opens a small text box.
  const chips = [...form.querySelectorAll('.bk-chip')];
  const LIMITS = { conditions: 300, allergies: 200 };

  // Rebuilds one group's hidden value from its tapped icons and its "Other" box.
  function syncGroup(group) {
    const on = chips.filter((c) => c.dataset.group === group && c.classList.contains('on')).map((c) => c.dataset.value);
    const otherBox = form.querySelector(`.bk-other[data-for="${group}"]`);
    const otherText = form[`${group}_other`].value.trim();
    otherBox.hidden = !on.includes('Other');
    const parts = on.filter((v) => v !== 'Other');
    if (on.includes('Other') && otherText) parts.push(otherText);
    form[group].value = parts.join(', ').slice(0, LIMITS[group]);
  }

  function paintChips() {
    chips.forEach((c) => c.setAttribute('aria-pressed', c.classList.contains('on')));
    syncGroup('conditions');
    syncGroup('allergies');
  }

  chips.forEach((c) => c.addEventListener('click', () => {
    const group = chips.filter((x) => x.dataset.group === c.dataset.group);
    const turningOn = !c.classList.contains('on');
    // "None" and the real answers can't both be picked.
    if (turningOn && c.dataset.value === 'None') group.forEach((x) => x.classList.remove('on'));
    if (turningOn && c.dataset.value !== 'None') group.find((x) => x.dataset.value === 'None')?.classList.remove('on');
    c.classList.toggle('on', turningOn);
    paintChips();
    if (turningOn && c.dataset.value === 'Other') form[`${c.dataset.group}_other`].focus();
  }));
  ['conditions', 'allergies'].forEach((g) => form[`${g}_other`].addEventListener('input', () => syncGroup(g)));
  form.addEventListener('reset', () => setTimeout(() => { chips.forEach((c) => c.classList.remove('on')); paintChips(); }, 0));

  /* ---------- Remember who is booking ---------- */
  // Signed in: name, phone and email come from their profile, so nothing is asked twice.
  // Guest: kept only in this browser (localStorage) when "Remember me" is ticked. Sign out clears it.
  const KEY = 'nn_booking_contact';
  const who = document.getElementById('bk-who');
  const whoText = document.getElementById('bk-who-text');
  const rememberRow = document.getElementById('bk-remember-row');
  const remember = document.getElementById('bk-remember');
  let signedIn = false;

  // Fills only the boxes that are still empty, so we never overwrite what someone is typing.
  function fill(c) {
    if (!c) return;
    if (c.name && !form.name.value) form.name.value = c.name;
    if (c.phone && !form.phone.value) form.phone.value = c.phone;
    if (c.email && !form.email.value) form.email.value = c.email;
    if (form.name.value && form.phone.value) {
      whoText.textContent = `Booking as ${form.name.value}.`;
      who.hidden = false;
    }
  }

  async function prefill() {
    try {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      signedIn = !!user;
      rememberRow.hidden = signedIn; // signed-in people don't need the checkbox
      if (user) {
        const { data: p } = await sb.from('profiles').select('full_name,email,phone').eq('id', user.id).maybeSingle();
        fill({ name: p?.full_name || user.user_metadata?.full_name, phone: p?.phone, email: p?.email || user.email });
      } else {
        fill(JSON.parse(localStorage.getItem(KEY) || 'null'));
      }
    } catch { /* no prefill is fine, the form still works */ }
    // Everything we need is already filled: start on the massage question.
    if (at === 0 && form.name.value && form.phone.value) go(1, false);
  }

  // Wipes the remembered details and empties the three boxes.
  document.getElementById('bk-clear').addEventListener('click', () => {
    localStorage.removeItem(KEY);
    ['name', 'phone', 'email'].forEach((f) => { form[f].value = ''; });
    who.hidden = true;
    form.name.focus();
  });

  // Save a guest's details when they send the booking (only if they left "Remember me" ticked).
  form.addEventListener('submit', () => {
    if (signedIn) return;
    if (remember.checked && form.name.value.trim() && form.phone.value.trim()) {
      localStorage.setItem(KEY, JSON.stringify({ name: form.name.value.trim(), phone: form.phone.value.trim(), email: form.email.value.trim() }));
    } else {
      localStorage.removeItem(KEY);
    }
  });

  // Signing out clears the remembered details on this device.
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') localStorage.removeItem(KEY); });

  paintBody();
  paintChips();
  go(0, false);
  prefill();
  form.addEventListener('reset', () => setTimeout(prefill, 50)); // "Book another" refills the details
})();
