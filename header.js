// Header turns solid once the page scrolls. Visual only.
const siteHeader = document.querySelector('.site-header');
if (siteHeader) {
  const onScroll = () => siteHeader.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// Footer account link mirrors the header one (Sign in / My account / Studio / Front desk), and hides "Create account" once signed in.
(() => {
  const head = document.getElementById('account-link'), foot = document.getElementById('footer-account');
  if (!head || !foot) return;
  const sync = () => {
    foot.textContent = head.textContent; foot.href = head.getAttribute('href');
    const create = document.getElementById('footer-create');
    if (create) create.hidden = head.textContent.trim() !== 'Sign in';
  };
  new MutationObserver(sync).observe(head, { childList: true, characterData: true, subtree: true, attributes: true });
})();

// Studio / front desk pages: today's date above the title. Visual only.
(() => {
  const el = document.getElementById('adm-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
})();
