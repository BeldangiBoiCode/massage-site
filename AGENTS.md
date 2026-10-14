# Namaste Nirvana Massage site

**Start here: read `HANDOFF.md`, especially the "READ FIRST: 2026-10-14 update" block at the top.** It explains the whole system: the Supabase connection, what each page and file does,
the booking/chat/review flows, which ids and class names the scripts depend on, and what is still not configured.

## Who does what
- Design (look, layout, copy, CSS): done here with Claude, pushed to GitHub.
- Backend (Supabase tables, auth, edge functions, cron, chat, bookings, admin CRM data logic): owned by Austin. On 2026-10-14 he asked
  for backend features directly, so those were built (see HANDOFF.md) and backend edits are fine when he asks. When you are only
  restyling, leave `supabase/`, `supabase-client.js`, `chat.js`, the inline `<script>` blocks and the data/booking logic in `app.js` alone.
  **Never run `supabase db push` or deploy functions unless Austin says so.** The 2026-10-14 migrations and functions ARE applied/deployed already
  (see HANDOFF.md; do not re-run them). New pages: `staff.html` (front desk), rebuilt `account.html`. Staff, admin and customer all have different views.
- After `git pull`, the site is already connected to the live backend. You can restyle everything and it keeps working,
  as long as you keep the ids, field names, `data-*` attributes and class names listed in `HANDOFF.md`.

## Rule: every new element gets a skeleton loader
Whenever you add or restyle an element that fills in after the page paints (anything fed by Supabase, images, lists,
cards, tables, time slots, the account/admin pages), show a skeleton placeholder first so loading looks seamless:
- Use the `.skeleton` classes at the bottom of `styles.css` (`skeleton-line`, `skeleton-block`, `skeleton-pill`, `skeleton-row`).
  Do not write a new loader.
- Match the final content's size so nothing jumps when the real content arrives.
- Remove the skeleton (or replace the node) once the data is in, and also when the request fails.
- Respect `prefers-reduced-motion` (already handled by the classes).

## Basics
- Plain HTML/CSS/vanilla JS, no build step. Colors and spacing come from the tokens in `:root` in `styles.css`.
- Extra pages use their own small stylesheets on top of `styles.css`: `auth-extra.css`, `admin.css`, `chat.css`, `review.css`.
- Run locally: `python3 -m http.server 8000`, then open http://localhost:8000.
- Deploy: `git push` to `main`; GitHub Pages rebuilds in about a minute.
- Never commit passwords or service-role keys. The browser key in `supabase-client.js` is public by design.
