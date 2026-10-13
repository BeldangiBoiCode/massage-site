# Namaste Nirvana Massage site

## Who does what
- Design (look, layout, copy, CSS): done here with Claude, pushed to GitHub.
- Backend (Supabase tables, auth, edge functions, cron): handled separately by Austin. Do not change `supabase/`,
  `supabase-client.js`, or the data/booking logic in `app.js` while restyling. If a visual change needs new data, say so
  instead of building it.

## Rule: every new element gets a skeleton loader
Whenever you add or restyle an element that fills in after the page paints (anything fed by Supabase, images, lists,
cards, tables, time slots, the account/admin pages), show a skeleton placeholder first so loading looks seamless:
- Use the `.skeleton` classes at the bottom of `styles.css` (`skeleton-line`, `skeleton-block`, `skeleton-pill`).
  Do not write a new loader.
- Match the final content's size so nothing jumps when the real content arrives.
- Remove the skeleton (or replace the node) once the data is in, and also when the request fails.
- Respect `prefers-reduced-motion` (already handled by the classes).

## Basics
- Plain HTML/CSS/vanilla JS, no build step. Colors and spacing come from the tokens in `:root` in `styles.css`.
- Extra auth/admin pages use `auth-extra.css` on top of `styles.css`.
