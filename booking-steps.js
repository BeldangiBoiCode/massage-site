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

  paintBody();
  go(0, false);
})();
