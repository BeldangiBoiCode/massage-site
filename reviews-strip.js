// Home page reviews strip: average rating + approved reviews (first name + last initial only).
// Shows skeleton cards while loading; with no reviews yet it shows a gentle "leave a review" prompt instead.
(async () => {
  const track = document.getElementById('rv-track');
  const sum = document.getElementById('rv-sum');
  if (!track) return;

  const [{ data: stats }, { data: list, error }] = await Promise.all([sb.rpc('review_stats'), sb.rpc('public_reviews')]);
  track.removeAttribute('aria-busy');

  if (error || !list?.length) {
    sum.textContent = '';
    track.outerHTML = `<div class="rv-empty"><span>No reviews yet. Had a session? Tell others how it went.</span>
      <a class="btn small" href="review.html">Leave a review</a></div>`;
    return;
  }

  const avg = Number(stats?.[0]?.average ?? 0), total = Number(stats?.[0]?.total ?? list.length);
  const stars = (n) => '★'.repeat(n) + `<i>${'★'.repeat(5 - n)}</i>`;
  sum.innerHTML = `<span class="gold" aria-hidden="true">★★★★★</span><b>${avg.toFixed(1)}</b> from ${total} review${total === 1 ? '' : 's'}`;
  track.innerHTML = list.slice(0, 12).map((r) => `<li class="rv-card">
      <span class="gold" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</span>
      <p>${esc(r.body)}</p>
      <small>${esc(r.name)}${r.service ? ' · ' + esc(r.service) : ''}</small>
    </li>`).join('');
})();
