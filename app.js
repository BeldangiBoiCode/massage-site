// Booking form: saves to Supabase `booking_requests`. Signed-in users get it linked to their profile.
const form = document.getElementById('booking');
const status = document.getElementById('status');
const button = form.querySelector('button');

form.date.min = new Date().toISOString().split('T')[0];

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
  const missing = ['name', 'phone', 'date'].filter((f) => !form[f].value.trim());
  if (missing.length) {
    status.className = 'status error';
    status.textContent = 'Add your name, phone and a date so we can confirm your spot.';
    form[missing[0]].focus();
    return;
  }
  button.disabled = true;
  const user = await currentUser();
  const addons = [...form.querySelectorAll('input[name=addon]:checked')].map((c) => c.value);
  const notes = [addons.length ? `Add-ons: ${addons.join(', ')}` : '', form.notes.value.trim()].filter(Boolean).join('\n');
  const { error } = await sb.from('booking_requests').insert({
    user_id: user?.id ?? null,
    name: form.name.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim() || null,
    service: form.service.value,
    duration_min: Number(form.duration.value),
    preferred_date: form.date.value,
    notes: notes || null,
  });
  button.disabled = false;
  if (error) {
    status.className = 'status error';
    status.textContent = 'That didn\'t go through. Call or text (802) 373-9672 and we\'ll book you by phone.';
    return;
  }
  status.className = 'status';
  status.textContent = `Requested. We'll text ${form.phone.value} to confirm your ${form.service.value.toLowerCase()} request.`;
  form.reset();
});
