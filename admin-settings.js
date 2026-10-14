// Studio settings sheet: preview other views, calendar links (Apple/Google), imported calendars.
(() => {
  const $ = (s) => document.querySelector(s);
  const sheet = $('#settings');
  $('#fab').addEventListener('click', () => { sheet.hidden = false; loadCalendars(); });
  $('#set-close').addEventListener('click', () => { sheet.hidden = true; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.hidden = true; });

  let loaded = false;
  async function loadCalendars() {
    if (loaded) return; loaded = true;
    const { data: url, error } = await sb.rpc('calendar_feed_url');
    const box = $('#cal-links');
    if (error || !url) { box.innerHTML = '<p class="c-sub">The calendar link isn\'t ready yet. Apply the latest database update, then reopen this.</p>'; }
    else {
      const web = url.replace(/^https?:/, 'webcal:');
      box.innerHTML = `<div class="acts wide">
        <a class="act main" href="${esc(web)}">Add to Apple Calendar</a>
        <a class="act" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(web)}" target="_blank" rel="noopener">Add to Google Calendar</a>
        <button class="act" type="button" id="copy-feed">Copy link</button></div>`;
      $('#copy-feed').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; } catch { prompt('Copy this link:', url); } });
    }
    listSources(); listConnections();
  }
  async function listSources() {
    const { data } = await sb.from('calendar_sources').select('*').order('created_at');
    $('#src-list').innerHTML = (data ?? []).map((c) => `<div class="visit-line"><span><b>${esc(c.label)}</b>${c.last_error ? ` · <span style="color:#9B3B32">${esc(c.last_error)}</span>` : c.last_synced_at ? ' · synced' : ' · waiting for first sync'}</span><button class="act danger" type="button" data-src="${c.id}">Remove</button></div>`).join('');
  }
  $('#src-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-src]'); if (!b || !confirm('Stop blocking times from this calendar?')) return;
    await sb.from('calendar_sources').delete().eq('id', b.dataset.src); listSources();
  });
  $('#src-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.from('calendar_sources').insert({ label: f.label.value.trim(), ics_url: f.url.value.trim() });
    if (error) return alert(error.message);
    f.reset(); listSources();
  });

  /* ---- Connected calendar accounts (Google OAuth, Apple CalDAV) ---- */
  const say = (m, bad) => { const el = $('#conn-status'); el.className = 'status' + (bad ? ' error' : ''); el.textContent = m; };
  async function call(action, body = {}) {
    const { data: s } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/calendar-connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.session.access_token}` },
      body: JSON.stringify({ action, ...body }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error ?? 'That did not work. Try again.');
    return out;
  }
  async function listConnections() {
    const { data, error } = await sb.from('calendar_connections').select('*').order('created_at');
    $('#conn-list').innerHTML = error ? '<p class="c-sub">Apply the latest database update to turn this on.</p>'
      : (data ?? []).map((c) => `<div class="visit-line"><span><b>${c.provider === 'google' ? 'Google' : 'Apple'}</b> · ${esc(c.account)}<br>
        <span class="c-sub">${c.last_error ? `<span style="color:#9B3B32">${esc(c.last_error)}</span>` : c.last_synced_at ? 'Synced ' + new Date(c.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Waiting for first sync'}</span></span>
        <button class="act danger" type="button" data-disc="${c.id}">Disconnect</button></div>`).join('') || '<p class="c-sub">No calendar accounts connected yet.</p>';
  }
  $('#conn-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-disc]'); if (!b || !confirm('Disconnect this calendar? Events already added stay in your calendar.')) return;
    try { await call('disconnect', { id: Number(b.dataset.disc) }); } catch (err) { say(err.message, true); }
    listConnections();
  });
  $('#conn-google').addEventListener('click', async () => {
    try { say('Opening Google...'); const out = await call('google-url', { return_to: location.origin + location.pathname }); location.href = out.url; }
    catch (err) { say(err.message, true); }
  });
  $('#conn-apple-toggle').addEventListener('click', () => { $('#apple-form').hidden = !$('#apple-form').hidden; });
  $('#apple-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { say('Checking with Apple...'); const out = await call('apple-save', { apple_id: f.apple_id.value.trim(), app_password: f.app_password.value });
      f.reset(); f.hidden = true; say(`Connected to "${out.calendar}". Appointments are being added now.`); listConnections(); }
    catch (err) { say(err.message, true); }
  });
  $('#conn-sync').addEventListener('click', async () => {
    try { say('Syncing...'); await call('sync'); say('Synced.'); listConnections(); } catch (err) { say(err.message, true); }
  });
  // Back from Google's consent screen.
  const back = new URLSearchParams(location.search).get('cal');
  if (back) {
    history.replaceState(null, '', location.pathname);
    $('#fab').click();
    say(back === 'google' ? 'Google Calendar connected. Appointments are being added now.' : back === 'cancelled' ? 'Google sign-in was cancelled.' : 'Google did not connect. Try again.', back !== 'google');
  }
})();
