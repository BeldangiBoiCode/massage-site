// Shared Supabase client. The anon key is public by design; RLS protects the data.
const SUPABASE_URL = 'https://aryarbjftnhyayhdlapw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7EzjaIpokmu6ma6io-CO4g_qdEod28G';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SITE_BASE = new URL('.', location.href).href; // works on localhost and GitHub Pages

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

async function isAdmin() {
  const { data } = await sb.rpc('is_admin');
  return data === true;
}

// Front-desk staff (table `staff`). Returns false if the staff migration is not applied yet.
async function isStaff() {
  const { data } = await sb.rpc('is_staff');
  return data === true;
}

// Signed in: swap the header "Sign in" link for the right area, and send "Book" buttons on other pages
// to the customer's own profile (it has the booking form built in), so nobody goes back to the home page.
currentUser().then(async (u) => {
  if (!u) return;
  const link = document.getElementById('account-link');
  const admin = await isAdmin();
  const staff = !admin && (await isStaff());
  if (link) {
    link.textContent = 'My account'; link.href = 'account.html';
    if (admin) { link.textContent = 'Studio'; link.href = 'admin.html'; }
    else if (staff) { link.textContent = 'Front desk'; link.href = 'staff.html'; }
  }
  if (!admin && !staff) document.querySelectorAll('[data-book]').forEach((a) => { a.href = 'account.html#book'; });
});
