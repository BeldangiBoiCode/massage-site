// Small helpers shared by the extra auth pages (auth, forgot-password, reset-password,
// account-security, admin-invite). Needs supabase-client.js loaded first.
const MIN_PASSWORD = 8;

function say(el, msg, isError = false) {
  el.className = 'status' + (isError ? ' error' : '');
  el.textContent = msg;
}

const validEmail = (e) => /^\S+@\S+\.\S+$/.test(e);

// Returns a message when the password is unacceptable, otherwise null.
function passwordProblem(pw, again) {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (again !== undefined && pw !== again) return 'The two passwords don\'t match.';
  return null;
}

// Disable a form's button while a request is running.
async function busy(button, fn) {
  button.disabled = true;
  try { return await fn(); } finally { button.disabled = false; }
}

// Pages that need a signed-in user send everyone else to the sign-in page.
async function requireUser() {
  const u = await currentUser();
  if (!u) location.replace('auth.html');
  return u;
}
