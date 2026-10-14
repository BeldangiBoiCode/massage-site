-- Profile photo + questionnaire, tips, POS payments, suggestions, chat deletion/retention, calendar link.
-- NOT applied automatically: review, then `supabase db push`. Needs 20261014000000_staff_role.sql first.

-- Profiles: photo + questionnaire ---------------------------------------
alter table public.profiles
  add column if not exists photo_path text,
  add column if not exists answers jsonb not null default '{}'::jsonb,
  add column if not exists onboarded_at timestamptz;

-- Private avatar bucket: each person writes only inside their own folder (<user id>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar read own, admin or staff" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin() or public.is_staff()));
create policy "avatar write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "avatar update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "avatar delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Tips and POS payments ---------------------------------------------------
alter table public.appointments add column if not exists tip numeric(8,2) not null default 0 check (tip >= 0 and tip < 10000);
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'pos', 'venmo', 'zelle', 'other'));

-- Front desk rings people up on the POS: they can record and see payments (not edit or delete them).
create policy "staff read payments"   on public.payments for select using (public.is_staff());
create policy "staff record payments" on public.payments for insert with check (public.is_staff());

-- Requests and suggestions from customers --------------------------------
create table public.suggestions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'suggestion' check (kind in ('request', 'suggestion')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.suggestions enable row level security;
create index on public.suggestions (user_id, created_at desc);
create policy "customer reads own suggestions"  on public.suggestions for select using (user_id = auth.uid());
create policy "customer sends suggestions"      on public.suggestions for insert with check (user_id = auth.uid());
create policy "admin all suggestions"           on public.suggestions for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.suggestions from anon;

-- Chat: customers may delete their own conversation; everything auto-deletes after 30 days ---
create policy "customer deletes own messages" on public.messages for delete using (customer_id = auth.uid());

select cron.schedule(
  'chat-retention',
  '17 3 * * *',
  $$ delete from public.messages where created_at < now() - interval '30 days'; $$
);

-- Staff (and the owner previewing the staff page) see basic client info + what they like --------
drop function if exists public.staff_clients();
create or replace function public.staff_clients()
returns table (id uuid, full_name text, phone text, email text, pressure_pref text, answers jsonb, photo_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.phone, p.email, p.pressure_pref, p.answers, p.photo_path
  from public.profiles p where public.is_staff() or public.is_admin() order by p.full_name;
$$;
revoke all on function public.staff_clients() from public, anon;
grant execute on function public.staff_clients() to authenticated;

-- Admin: the private calendar subscription link (Apple + Google Calendar). ------------------
create or replace function public.calendar_feed_url()
returns text language sql stable security definer set search_path = '' as $$
  select (select value from public.app_settings where key = 'project_url') || '/functions/v1/calendar-feed?token='
         || (select value from public.app_settings where key = 'feed_token')
  where public.is_admin();
$$;
revoke all on function public.calendar_feed_url() from public, anon;
grant execute on function public.calendar_feed_url() to authenticated;

-- Reviews: only for completed visits (status 'done', set by Nikesh), one review per visit. ----------
alter table public.reviews add column if not exists appointment_id bigint unique references public.appointments(id) on delete set null;

-- The signed-in customer's finished visits that don't have a review yet.
create or replace function public.reviewable_visits()
returns table (id bigint, service text, starts_at timestamptz, duration_min int)
language sql stable security definer set search_path = '' as $$
  select a.id, a.service, a.starts_at, a.duration_min
  from public.appointments a
  where a.user_id = auth.uid() and a.status = 'done'
    and not exists (select 1 from public.reviews r where r.appointment_id = a.id)
  order by a.starts_at desc;
$$;
revoke all on function public.reviewable_visits() from public, anon;
grant execute on function public.reviewable_visits() to authenticated;

-- Time off is public: the site shows it (with Nikesh's note) and booking stays blocked for those times. ------
create or replace function public.public_time_off()
returns table (starts_at timestamptz, ends_at timestamptz, reason text)
language sql stable security definer set search_path = '' as $$
  select t.starts_at, t.ends_at, t.reason
  from public.time_off t
  where t.ends_at > now() and t.starts_at < now() + interval '60 days'
  order by t.starts_at limit 20;
$$;
grant execute on function public.public_time_off() to anon, authenticated;

-- When a customer writes while Nikesh is away, send one automatic reply with the return date.
create or replace function public.away_auto_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  back timestamptz;
  why text;
  grown boolean := true;
  tz constant text := 'America/New_York';
  when_txt text;
begin
  if new.sender <> 'customer' then return new; end if;

  select max(t.ends_at) into back from public.time_off t where t.starts_at <= now() and t.ends_at > now();
  if back is null then return new; end if;

  -- Follow back-to-back breaks to the real return time.
  while grown loop
    select max(t.ends_at) into back from public.time_off t where t.starts_at <= back and t.ends_at > back;
    grown := exists (select 1 from public.time_off t where t.starts_at <= back and t.ends_at > back);
  end loop;

  -- One automatic reply per customer per 12 hours.
  if exists (select 1 from public.messages m where m.customer_id = new.customer_id and m.sender = 'admin'
             and m.body like 'Automatic reply:%' and m.created_at > now() - interval '12 hours') then
    return new;
  end if;

  select t.reason into why from public.time_off t where t.starts_at <= now() and t.ends_at > now()
    and t.reason is not null and btrim(t.reason) <> '' order by t.ends_at desc limit 1;

  when_txt := to_char(back at time zone tz, 'FMDay, FMMonth FMDD');
  if (back at time zone tz)::time <> time '00:00' then
    when_txt := when_txt || ' at ' || lower(to_char(back at time zone tz, 'FMHH12:MIam'));
  end if;

  insert into public.messages (customer_id, sender, body)
  values (new.customer_id, 'admin',
    'Automatic reply: Nikesh is away' || coalesce(' (' || btrim(why) || ')', '') ||
    ' and will be back on ' || when_txt || '. He will read your message then. Online booking is paused until he is back.');
  return new;
end;
$$;
revoke execute on function public.away_auto_reply() from public, anon, authenticated;
create trigger messages_away_reply after insert on public.messages
  for each row execute function public.away_auto_reply();

-- Chat with anyone: guests (booked with only a phone or email) get a thread keyed 'g:<phone digits or email>'. ------
-- Only Nikesh writes into guest threads; guests can't read them until they make an account (then they merge by verified email).
alter table public.messages alter column customer_id drop not null;
alter table public.messages add column if not exists guest_key text check (char_length(guest_key) between 3 and 140);
alter table public.messages add constraint messages_one_owner check ((customer_id is null) <> (guest_key is null));
alter table public.messages add constraint messages_guest_admin_only check (guest_key is null or sender = 'admin');
create index on public.messages (guest_key, created_at) where guest_key is not null;

create or replace function public.claim_guest_messages()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- Only the verified sign-in email counts (phone numbers are typed in by the user and can't prove anything).
  update public.messages m set customer_id = auth.uid(), guest_key = null
  where m.guest_key = 'g:' || lower((select email from auth.users where id = auth.uid() and email_confirmed_at is not null));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.claim_guest_messages() from public, anon;
grant execute on function public.claim_guest_messages() to authenticated;

-- Calendar accounts (Google OAuth, Apple CalDAV): appointments are written into the owner's real calendar. ------------
-- Tokens / app passwords are kept ENCRYPTED in Supabase Vault. The browser can only see which accounts are connected,
-- never the secrets. Only edge functions (service role) can read or write them.
create table public.calendar_connections (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('google', 'apple')),
  account text not null,              -- the Google email or Apple ID (display only)
  secret_id uuid not null,            -- pointer to the encrypted secret in vault.secrets
  calendar_ref text not null,         -- Google calendar id, or the Apple calendar URL
  status text not null default 'ok',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (provider, account)
);
alter table public.calendar_connections enable row level security;
create policy "admin reads calendar connections" on public.calendar_connections for select using (public.is_admin());
revoke all on public.calendar_connections from anon;
revoke insert, update, delete on public.calendar_connections from authenticated;

-- Which appointment became which event in which calendar (so edits and cancellations follow).
create table public.calendar_events (
  appointment_id bigint not null references public.appointments(id) on delete cascade,
  connection_id bigint not null references public.calendar_connections(id) on delete cascade,
  remote_id text not null,
  synced_hash text,
  primary key (appointment_id, connection_id)
);
alter table public.calendar_events enable row level security;   -- no policies: server only

create or replace function public.store_calendar_secret(p_name text, p_secret text)
returns uuid language sql security definer set search_path = '' as $$ select vault.create_secret(p_secret, p_name); $$;
create or replace function public.read_calendar_secret(p_id uuid)
returns text language sql security definer set search_path = '' as $$ select decrypted_secret from vault.decrypted_secrets where id = p_id; $$;
create or replace function public.delete_calendar_secret(p_id uuid)
returns void language sql security definer set search_path = '' as $$ delete from vault.secrets where id = p_id; $$;
revoke all on function public.store_calendar_secret(text, text), public.read_calendar_secret(uuid), public.delete_calendar_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_calendar_secret(text, text), public.read_calendar_secret(uuid), public.delete_calendar_secret(uuid) to service_role;

-- Push appointments to connected calendars every 5 minutes (a safety net; "Sync now" and edits also trigger it).
select cron.schedule(
  'calendar-push',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'project_url') || '/functions/v1/calendar-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret')),
    body := '{}'::jsonb
  );
  $$
);

-- Never double-book: the database itself refuses a scheduled appointment that overlaps another one
-- (including the 15 minute break after each session), whoever tries it: staff, owner, or the booking function. ----------
create or replace function public.reject_overlapping_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'scheduled' and exists (
    select 1 from public.appointments a
    where a.id is distinct from new.id and a.status = 'scheduled'
      and a.starts_at < new.starts_at + make_interval(mins => new.duration_min + 15)
      and a.starts_at + make_interval(mins => a.duration_min + 15) > new.starts_at
  ) then
    raise exception 'That time is already taken by another appointment.' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke execute on function public.reject_overlapping_appointment() from public, anon, authenticated;
create trigger appointments_no_overlap before insert or update of starts_at, duration_min, status on public.appointments
  for each row execute function public.reject_overlapping_appointment();
