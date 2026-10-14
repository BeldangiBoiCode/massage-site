# Handoff: what changed and how it all connects

> ## READ FIRST: 2026-10-14 update (big)
> A lot was added on 2026-10-14. **The code is pushed, but the database changes and edge functions are NOT applied to the live
> Supabase project yet.** Until they are, parts of the live site degrade (see "Apply order"). Do not "fix" these by deleting
> the new code; apply the migrations. If you are a Claude session starting up: read this whole section before touching anything.
>
> ### Apply order (Austin runs these, or says go ahead)
> 1. `supabase db push` applies, in order: `20261014000000_staff_role.sql`, `20261014000100_profiles_tips_suggestions.sql`,
>    `20261014000200_break_15_quarter_hours.sql`, `20261014000300_loyalty_points.sql`.
> 2. Deploy functions with `--no-verify-jwt`: `calendar-feed`, `submit-review`, `calendar-connect`, `google-callback`, `calendar-push`.
> 3. Add front-desk staff by SQL (example at the top of the staff migration).
> 4. Google Calendar sign-in needs a Google Cloud OAuth client: set secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add the
>    redirect URI `<project-url>/functions/v1/google-callback`. Apple uses an app-specific password (no setup needed).
> 5. If the database is still on the old rules, the browser now offers :15/:45 start times and a 15 minute break that the old server
>    rejects (old rule: 20 min break, :00/:30 only). Migration `...000200` fixes that. Review submission also needs migration `...000100`.
>
> ### What was added (all in this repo)
> | Area | Files | Notes |
> |---|---|---|
> | Moving clouds + footer account links | `index.html`, `styles.css` (`.sky`, `.foot-account`), `header.js` | Clouds drift across the whole sky; reduced-motion = static. Footer link mirrors the header link (Sign in / My account / Studio / Front desk). |
> | **Staff (front desk) role** | `staff.html`, migration `...000000_staff_role.sql`, `supabase-client.js` (`isStaff()`), `account.html` redirect | Table `staff`, `is_staff()`. Staff: see/make/cancel appointments, mark done/no-show, tips, "charged on POS", basic client info (`staff_clients()`), set breaks. NO money totals, reviews, chat, private notes or health info. Admin can preview with `?preview=1`. |
> | Admin (Studio) redesign | `admin.css` (desktop sidebar + 2 column cards, tips/likes/avatars, Settings sheet), `admin.html` | Desktop layout from 1000px. Phone layout unchanged. All `data-act`/`data-tab`/`p-*` ids kept. |
> | Admin Settings (bottom-right button) | `admin-settings.js`, `admin.html` | Preview as customer / employee, "My profile", calendar links (webcal + Google), ICS import, connect Google/Apple accounts. |
> | Customer profile rebuilt | `account.html`, `account.css`, `stretches.js` | Photo upload (private `avatars` bucket), questionnaire in `profiles.answers`, auto-fill from signup, change email/phone, requests and suggestions to Nikesh (`suggestions`), free stretches by body area, visits + DEMO payment (no real charge), messages list with delete, loyalty points card. **Booking form is built into this page** (same ids as the home page; `app.js` runs on both). |
> | Inline booking links | `supabase-client.js` | Links with `data-book` on other pages go to `account.html#book` for signed-in customers. |
> | Tips + POS | `admin.html`, `staff.html`, migration `...000100` | `appointments.tip`; payment method `pos`; "Charged on the POS" records a payment by hand. There is no live link to the Windows POS yet. |
> | Reviews only for finished visits | `review.html`, `supabase/functions/submit-review`, migration `...000100` | Needs a signed-in user with an appointment `status='done'` (set by Nikesh/front desk), one review per visit (`reviews.appointment_id`). `reviewable_visits()` RPC. Nikesh still approves/hides in Studio. |
> | Time off is public | `away.js`, `admin-timeoff.html`, migration `...000100` (`public_time_off()`, `away_auto_reply()` trigger) | Note shows in a banner on the home page and profile. A customer who chats while he is away gets ONE automatic reply (per 12h) with the reason and return date. |
> | Days he is away / full never show in the booking calendar | `app.js` (`scanDays`, `freeStarts`, `isAway`) | Home page AND profile page. The calendar asks `busy_slots` for every open day and hides days with no free start time. The server (`slot_problem`) is still the real check. |
> | Calendar picker for time off | `rangecal.js`, `styles.css` (`.rcal`), `admin-timeoff.html`, `staff.html` | One component: single day or range, marks existing time off. |
> | Staff booking shows all time slots | `staff.html` (`renderSlots`) | Every start time for the picked day; taken ones greyed. Hard block on overlap, re-checked against fresh data before saving. |
> | No double booking + 15 min break | `staff.html`, `app.js` (`BREAK=15`, `STEP=15`), migrations `...000100` (overlap trigger) and `...000200` | A session gets its full 60/90 min, then a 15 min break; starts on any quarter hour. Austin said both "15" and "50" minutes; **15 was chosen**. Confirm with him if unsure. |
> | Chat with anyone | `chat.js` (`guestKey`), `admin.html`, migration `...000100` | Guests (no account) get a thread keyed `g:<phone digits or email>`; only Nikesh writes there. They merge into the account by VERIFIED email on login (`claim_guest_messages()`). Customers can delete their chat; messages auto-delete after 30 days (cron `chat-retention`). |
> | Admin must re-enter password for Security | `account-security.html` | Admin accounts only, every time the page opens. |
> | Real calendar connections | `supabase/functions/calendar-connect`, `google-callback`, `calendar-push`, migration `...000100` | Google (OAuth) and Apple (CalDAV app password) accounts; secrets stored encrypted in Supabase **Vault** (`calendar_connections` only holds a pointer). `calendar-push` writes/updates/removes events every 5 min (cron) or on "Sync now". `calendar-feed` now includes full client details in the event (secret URL). **These functions were written but never run or type-checked. Test them before relying on them.** |
> | Loyalty points | migration `...000300`, `account.html`, `admin.html`, `staff.html` | Ledger `loyalty_points`. 1 point per dollar of session price, awarded by DB triggers only when the visit is `done` AND paid in full; taken back if un-done/unpaid. Owner can adjust per client in Studio. No reward menu yet (redeem = negative entry). |
>
> ### Still not built / open
> - Customer emails (needs the studio domain + `RESEND_API_KEY`), SMS (Twilio).
> - Direct integration with the Windows POS (two screens). Today POS payments are recorded by hand.
> - Employee clock in/out for hours (planned to cover the POS too).
> - Reward menu for loyalty points. Several separate chat threads per customer (today: one thread with Nikesh).
>
> ### Rules that still apply
> Keep the ids/classes listed below, add a `.skeleton` loader for anything that loads after paint, never commit secrets. The old rule
> "design only, never touch the backend" no longer holds: Austin asked for backend features directly, so backend changes are in
> scope, but **never apply migrations or deploy functions without Austin saying so**.

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
