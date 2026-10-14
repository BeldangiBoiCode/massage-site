# Namaste Nirvana Massage site

**Start here: read `HANDOFF.md`, especially the "READ FIRST: 2026-10-14 update" block at the top.** It explains the whole system: the Supabase connection, what each page and file does,
the booking/chat/review flows, which ids and class names the scripts depend on, and what is still not configured.

## STOP: design only. No backend work, ever (unless you are Austin's own session)
**If you are working for the designer (git author "Home"), your job is ONLY how the site looks.** Colors, fonts, spacing, layout,
images, animations, copy/text, responsive/mobile polish, and the visual markup of pages. Do nothing else.

**Never do any of this, even if it seems small or helpful:**
- Never touch the backend: `supabase/` (migrations, edge functions), `supabase-client.js`, `chat.js`, `admin-settings.js`.
- Never change `<script>` blocks inside any `.html` page, or the data/booking/payment/chat/loyalty logic in `app.js`, `rangecal.js`'s data hooks,
  `away.js`, `header.js` behavior, or anything that calls `sb.` (Supabase), `fetch(`, or `rpc(`.
- Never run `supabase` commands, `supabase db push`, deploy functions, or use any Supabase tool. (`.claude/settings.json` blocks these.)
- Never add or change tables, columns, policies, roles, secrets, cron jobs, buckets or auth settings.
- Never build a new feature that needs data. If a design needs new data or behavior, **stop and tell the user: "this needs Austin (backend)"**
  and describe what is needed in plain words. Do not build a workaround, do not fake the data in the browser.
- Never apply, edit or "fix" migrations. The 2026-10-14 ones are already live; they must not be re-run.

**Austin's own sessions** (author "Ap") may do backend work, but only when Austin explicitly asks, and never apply migrations or
deploy functions without him saying so.

**What you CAN freely edit:** `styles.css`, `admin.css`, `account.css`, `chat.css`, `review.css`, `auth-extra.css`, `decor/`, images/fonts,
the text and markup (not `<script>`) of pages, `stretches.js` copy (the words only), and `HANDOFF.md`/`CLAUDE.md` notes.
Keep every id, `name`, `data-*` attribute and class that scripts look up (list in `HANDOFF.md`). The site is already connected to the live backend;
after `git pull` you can restyle everything and it keeps working as long as those names stay.

**Roles you will see (restyle all of them, change none of the logic):** customers (`account.html`, `review.html`, `auth.html`, home page),
front-desk employees (`staff.html`), and the owner (`admin.html`, `admin-timeoff.html`, `account-security.html`). Admin can preview
the customer/employee views from Studio > Settings. All must look good on phones.

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
