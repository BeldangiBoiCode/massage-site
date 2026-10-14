// Chat thread between one customer account and Nikesh. Used by account.html (me = 'customer')
// and admin.html (me = 'admin'). Live updates through Supabase Realtime, with a slow poll as a safety net.
// RLS decides who can read or write; this file only draws the thread.
function mountChat(root, { customerId, guestKey, me, placeholder }) {
  const col = guestKey ? 'guest_key' : 'customer_id', val = guestKey ?? customerId; // guest threads are keyed by phone/email
  const other = me === 'admin' ? 'customer' : 'admin';
  root.classList.add('chat');
  root.innerHTML = `
    <div class="chat-log" role="log" aria-live="polite" aria-label="Messages"><div class="skeleton chat-skel"></div></div>
    <form class="chat-form">
      <textarea rows="1" maxlength="1000" placeholder="${esc(placeholder ?? 'Write a message')}" aria-label="Message"></textarea>
      <button class="btn small" type="submit">Send</button>
    </form>
    <p class="chat-err" role="alert" hidden></p>`;
  const log = root.querySelector('.chat-log');
  const form = root.querySelector('.chat-form');
  const ta = form.querySelector('textarea');
  const err = root.querySelector('.chat-err');
  let msgs = [], channel = null, timer = null, sending = false;

  const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

  function render() {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (!msgs.length) {
      log.innerHTML = `<p class="chat-empty">${me === 'customer' ? 'No messages yet. Ask Nikesh anything about your visit.' : 'No messages yet.'}</p>`;
      return;
    }
    let last = '', html = '';
    for (const m of msgs) {
      const d = dayLabel(m.created_at);
      if (d !== last) { last = d; html += `<div class="chat-day">${esc(d)}</div>`; }
      html += `<div class="msg ${m.sender === me ? 'mine' : 'theirs'}"><p>${esc(m.body)}</p><span>${esc(timeLabel(m.created_at))}${m.sender === me && m.read_at ? ' · seen' : ''}</span></div>`;
    }
    log.innerHTML = html;
    if (atBottom || !log.dataset.ready) { log.scrollTop = log.scrollHeight; log.dataset.ready = '1'; }
  }

  async function markRead() {
    const ids = msgs.filter((m) => m.sender === other && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    const stamp = new Date().toISOString();
    const { error } = await sb.from('messages').update({ read_at: stamp }).in('id', ids);
    if (!error) { msgs.forEach((m) => { if (ids.includes(m.id)) m.read_at = stamp; }); root.dispatchEvent(new CustomEvent('chat:read')); }
  }

  async function load() {
    const { data, error } = await sb.from('messages').select('*').eq(col, val).order('created_at').limit(300);
    if (error) { log.innerHTML = '<p class="chat-empty">Messages couldn\'t load. Try refreshing.</p>'; return; }
    msgs = data ?? [];
    render();
    markRead();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body || sending) return;
    sending = true; err.hidden = true;
    form.querySelector('button').disabled = true;
    const { data, error } = await sb.from('messages').insert({ [col]: val, sender: me, body }).select().single();
    sending = false;
    form.querySelector('button').disabled = false;
    if (error) { err.textContent = error.message || 'That didn\'t send. Try again.'; err.hidden = false; return; }
    ta.value = ''; ta.style.height = '';
    if (!msgs.some((m) => m.id === data.id)) msgs.push(data);
    render();
    log.scrollTop = log.scrollHeight;
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });

  channel = sb.channel(`chat-${me}-${val}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `${col}=eq.${val}` }, (p) => {
      if (msgs.some((m) => m.id === p.new.id)) return;
      msgs.push(p.new); render();
      if (p.new.sender === other) { markRead(); root.dispatchEvent(new CustomEvent('chat:new')); }
    })
    .subscribe();
  timer = setInterval(() => { if (!document.hidden) load(); }, 25000);

  load();
  return { reload: load, destroy() { if (channel) sb.removeChannel(channel); clearInterval(timer); } };
}
