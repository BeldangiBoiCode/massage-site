// Shared Supabase client. The anon key is public by design; RLS protects the data.
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

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

// Swap the header "Sign in" link to "My account" when signed in.
currentUser().then((u) => {
  const link = document.getElementById('account-link');
  if (u && link) { link.textContent = 'My account'; link.href = 'account.html'; }
});
