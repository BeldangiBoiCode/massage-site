# Handoff: what changed and how it all connects

Read this first when you pull. It explains everything added to this repo on 2026-10-13/14 so you can keep
working on **the look** without breaking **the backend**. (`CLAUDE.md` has the short version of the rules.)

## TL;DR
- The site is still plain HTML/CSS/JS on GitHub Pages. No build step.
- It is now **fully connected to a real Supabase backend**: bookings, login, customer profiles, chat, reviews, an admin CRM,
  calendar sync and reminders. All of that is already built, deployed and tested.
- **You (design) only touch the look.** Backend/data logic is handled separately (Austin). See "Safe to change / don't touch".
- Live site: https://beldangiboicode.github.io/massage-site/ (rebuilds ~1 min after `git push` to `main`).

## Connections
| Thing | Value |
|---|---|
| Supabase project | "BeldangiBoiCode's Project", ref `aryarbjftnhyayhdlapw` |
| API URL | `https://aryarbjftnhyayhdlapw.supabase.co` |
| Browser key | the publishable key in `supabase-client.js` (public by design; Row Level Security protects the data) |
| Dashboard | https://supabase.com/dashboard/project/aryarbjftnhyayhdlapw |
| Owner login | `admin@massage.com` (password is set in the Supabase dashboard, not in this repo) |

Never commit service-role keys or passwords. The server tokens live in the database table `app_settings`, not in code.
(The older project `namaste-nirvana` is obsolete and is being deleted. Do not use it.)

## Who sees what
- **Customers** use `account.html` (profile, visits, chat with Nikesh). If a customer opens an admin page they are sent back to `account.html`.
- **The owner (admin)** uses `admin.html` only. If the admin opens `account.html` they are sent to `admin.html`.
- Admin = a row in the `admins` table. Everything admin-only is enforced by database security rules (RLS), not just by hiding pages.

## Pages and files
| File | What it is |
|---|---|
| `index.html`, `app.js` | Home page. `app.js` runs the booking form (calendar of **open days only**, time chips, confirmation card + calendar file). |
| `reviews-strip.js` | Home page reviews strip (average rating + approved reviews). |
| `review.html`, `review.css` | "Review your visit" page (stars + text) and the list of approved reviews. |
| `auth.html` | **The sign-in page**: Google, Apple, password, create account, email link. `login.html` just redirects here. |
| `forgot-password.html`, `reset-password.html` | Forgot / set new password (also where admin invites land). |
| `account.html` | Customer area. `account-security.html` = change email / password. |
| `admin.html`, `admin.css` | Owner CRM, phone-first: Schedule, Clients, Chat, Money, Reviews, Breaks. |
| `admin-timeoff.html` | Owner sets days off / breaks (blocks booking). `admin-invite.html` = invite a user. |
| `chat.js`, `chat.css` | Shared chat component (customer side + admin side). |
| `auth.js`, `auth-extra.css` | Small helpers/styles for the auth + admin pages. |
| `supabase-client.js` | Supabase connection and helpers (`sb`, `currentUser()`, `isAdmin()`, `esc()`). |
| `styles.css` | Main styles + the polish layer + skeleton loaders. |
| `supabase/migrations/*.sql` | The whole database, in order. `supabase/functions/*` = edge functions. |

## Safe to change vs don't touch
**Change freely (the look):** colors, fonts, spacing, layout, copy, images, animations in `styles.css`, `admin.css`, `chat.css`,
`review.css`, `auth-extra.css`, and the markup/text of pages.

**Keep these working when you restyle** (the JS looks them up):
- Booking form in `index.html`: ids `booking`, `status`, `cal`, `slots`, `slot-hint`, `day-label`; field names `name, phone, email, service, duration, date, time, addon, notes`.
  The `date` and `time` fields are hidden inputs filled by `app.js`. The calendar and time chips are drawn by `app.js` into `#cal` and `#slots`.
- Reviews strip ids `rv-track`, `rv-sum`; review form ids/names in `review.html`.
- Admin pages: the `data-act`, `data-tab`, `data-id` attributes and the `p-*` panel ids in `admin.html`.
- Auth pages: form/input names and ids used by their inline scripts.
- Class names `.skeleton`, `.skeleton-*`, `.chip`, `.day`, `.cal`, `.act`, `.a-card` are used by scripts. Restyle them, don't rename them.

**Don't touch** (backend; ask Austin): `supabase/`, `supabase-client.js`, the data logic inside `app.js`, `chat.js`, the inline `<script>` blocks.

## Skeleton rule (important)
Anything that loads in after the page paints (Supabase data, lists, cards, time slots) must show a skeleton placeholder first.
Use the `.skeleton`, `.skeleton-line`, `.skeleton-block`, `.skeleton-pill`, `.skeleton-row` classes at the bottom of `styles.css`.
Match the final size so nothing jumps. Details are in `CLAUDE.md`.

## How booking works (so you understand what the form does)
1. Customer picks a day (only open days are shown) and a time. Taken times and the 20-minute break after each session are hidden.
2. The form POSTs to the edge function **`submit-booking`**: validates input, blocks spam (hidden `website` field + IP/phone rate limits), saves a request.
3. **`process-bookings`** immediately confirms or declines it against opening hours, existing appointments, the owner's time off and his synced Google/Apple calendar.
   A cron job also runs it every minute as a safety net. Confirmed bookings become rows in `appointments`.
4. The public can only see **when** a time is taken (`busy_slots(d)`), never who. Browsers cannot write to booking tables directly (RLS blocks it).
5. Confirmed customers get an email if Resend is configured (see "Not configured yet").

## Backend inventory
**Tables (all have RLS):** `booking_requests`, `appointments`, `opening_hours`, `time_off`, `calendar_sources`, `external_busy`, `profiles`, `admins`,
`notifications`, `payments`, `discounts`, `reviews`, `messages`, `customer_notes`, `app_settings` (server-only), `rate_limits` (server-only).

**Edge functions:** `submit-booking`, `process-bookings`, `send-reminders`, `calendar-sync`, `calendar-feed`, `invite-user`, `submit-review`.

**Cron jobs:** `process-bookings` (every minute, only if something is waiting), `calendar-sync` (every 15 min), `appointment-reminders` (hourly), `rate-limit-cleanup` (hourly).

**Hours** live in the `opening_hours` table (currently Sunday + Monday, 9am-8pm, America/New_York). Change the rows to change the days; the calendar adapts.

**Chat:** `messages` table, realtime. A customer can only read/write their own thread (RLS-tested). Guests without an account are reached by call/text/email.

**Reviews:** `review.html` -> `submit-review` (validation, link blocking, IP limit) -> `reviews` (pending until the owner approves in the admin Reviews tab)
-> public sees approved ones via `public_reviews()` / `review_stats()`.

## Auth redirects (nothing to change in code)
Sign-up confirmation, email sign-in link, Google/Apple -> `account.html`. Forgot-password -> `reset-password.html`.
Admin invite -> `reset-password.html?invite=1`. Change-email confirmation -> `account-security.html`.
All use the current site address automatically, so they work on GitHub Pages and on `http://localhost:8000`.

## Run locally
```
cd massage-site && python3 -m http.server 8000      # then open http://localhost:8000
```

## Applying the database to a fresh Supabase project
```
supabase link --project-ref <ref>
supabase db push
supabase functions deploy --no-verify-jwt
```
Then set the project URL once so the cron jobs know where to call:
`insert into public.app_settings values ('project_url', 'https://<ref>.supabase.co');`

## Not configured yet / known gaps
- Instagram and TikTok links in the footer (need the real URLs). The footer already has the small "Developed by Beldangi Fax Machine" line.
- Reminder/confirmation emails need a `RESEND_API_KEY` edge-function secret (and a verified sending domain). Texts need Twilio keys.
- Supabase dashboard auth settings: redirect URLs, Google/Apple provider keys, custom SMTP, leaked-password protection. See `Downloads/namaste-nirvana-auth-links.txt` on Austin's machine.
- Owner's Google/Apple calendar: add the calendar's private ICS link as a row in `calendar_sources` and its busy times start blocking bookings automatically.
- Discounts/messages from the admin open the phone's own text/email app (no sending service). Only message people who agreed to hear from the studio.
- `pg_net` extension sits in the `public` schema (advisor warning, harmless for now).
