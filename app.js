// Booking form: client-side only for now. Later: insert into Supabase `booking_requests`.
const form = document.getElementById('booking');
const status = document.getElementById('status');

form.date.min = new Date().toISOString().split('T')[0];

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const missing = ['name', 'phone', 'date'].filter((f) => !form[f].value.trim());
  if (missing.length) {
    status.className = 'status error';
    status.textContent = 'Add your name, phone and a date so we can confirm your spot.';
    form[missing[0]].focus();
    return;
  }
  status.className = 'status';
  status.textContent = `Requested. We'll text ${form.phone.value} to confirm your ${form.service.value.toLowerCase()} request.`;
  form.reset();
});
