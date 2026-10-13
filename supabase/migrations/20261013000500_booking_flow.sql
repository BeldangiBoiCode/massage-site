-- Booking flow: the website never writes to booking_requests directly any more.
--   browser -> edge fn submit-booking (validation + IP rate limit) -> insert request
--           -> edge fn process-bookings (also on cron) -> process_booking_requests()
--           -> confirmed appointment (shows in the calendar feed + busy_slots) or declined with a reason.

-- preferred_time may already exist from 20261013000200_time_slots.sql.
alter table public.booking_requests
  add column if not exists preferred_time time,
  add column if not exists decline_reason text,
  add column if not exists processed_at timestamptz;
update public.booking_requests set preferred_time = '09:00' where preferred_time is null;
alter table public.booking_requests alter column preferred_time set not null;

-- slot_problem() below replaces the insert-time trigger from time_slots.sql.
drop trigger if exists booking_slot_check on public.booking_requests;
drop function if exists public.check_booking_slot();

-- Direct browser inserts are closed; only the edge function (service role) inserts.
drop policy "anyone can request" on public.booking_requests;

-- Opening hours (America/New_York). A weekday with no row is closed. 0 = Sunday.
create table public.opening_hours (
  weekday smallint primary key check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  check (closes_at > opens_at)
);
alter table public.opening_hours enable row level security;
create policy "anyone reads hours" on public.opening_hours for select using (true);
create policy "admin writes hours" on public.opening_hours for all
  using (public.is_admin()) with check (public.is_admin());
insert into public.opening_hours values (0, '09:00', '20:00'), (1, '09:00', '20:00');

-- Rate limiting, kept in Postgres for now. To move to Redis later, only the
-- rateLimit() helper in submit-booking has to change.
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table public.rate_limits enable row level security;  -- no policies: service role only

create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_secs int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_secs) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window_secs) then 1 else r.hits + 1 end
  returning hits into v;
  return v <= p_max;
end;
$$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

select cron.schedule('rate-limit-cleanup', '17 * * * *',
  $$ delete from public.rate_limits where window_start < now() - interval '1 day' $$);

-- Why a slot can't be booked (null = free): notice, horizon, hours, clashes with
-- appointments (15 min buffer) and with Nikesh's synced calendars.
create or replace function public.slot_problem(p_start timestamptz, p_minutes int)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_end timestamptz := p_start + make_interval(mins => p_minutes);
  v_local timestamp := p_start at time zone 'America/New_York';
  v_end_local timestamp := v_end at time zone 'America/New_York';
  h record;
begin
  if p_start < now() + interval '2 hours' then return 'Please pick a time at least 2 hours from now.'; end if;
  if p_start > now() + interval '60 days' then return 'Bookings open up to 60 days ahead.'; end if;
  select * into h from public.opening_hours where weekday = extract(dow from v_local)::int;
  if not found or v_local::time < h.opens_at or v_end_local::time > h.closes_at or v_end_local::date <> v_local::date then
    return 'That time is outside opening hours.';
  end if;
  if exists (select 1 from public.appointments a
              where a.status = 'scheduled'
                and tstzrange(a.starts_at, a.starts_at + make_interval(mins => a.duration_min))
                    && tstzrange(p_start - interval '15 minutes', v_end + interval '15 minutes'))
     or exists (select 1 from public.external_busy b where tstzrange(b.starts_at, b.ends_at) && tstzrange(p_start, v_end)) then
    return 'That time is already booked.';
  end if;
  return null;
end;
$$;
revoke all on function public.slot_problem(timestamptz, int) from public, anon, authenticated;
grant execute on function public.slot_problem(timestamptz, int) to service_role;

-- Turns every 'new' request into a confirmed appointment or a decline. Serialized so
-- two people can't take the same slot.
create or replace function public.process_booking_requests()
returns table (out_request_id bigint, out_status text, out_reason text, out_appointment_id bigint)
language plpgsql security definer set search_path = '' as $$
declare r record; v_start timestamptz; v_problem text; v_appt bigint;
begin
  perform pg_advisory_xact_lock(7001);
  for r in select * from public.booking_requests where status = 'new' order by id limit 50 for update skip locked loop
    v_start := (r.preferred_date + r.preferred_time) at time zone 'America/New_York';
    v_problem := public.slot_problem(v_start, r.duration_min);
    out_request_id := r.id; out_reason := v_problem; out_appointment_id := null;
    if v_problem is null then
      insert into public.appointments (user_id, booking_id, client_name, client_phone, client_email, service, starts_at, duration_min, price)
      values (r.user_id, r.id, r.name, r.phone, r.email, r.service, v_start, r.duration_min,
              case r.duration_min when 60 then 85 when 90 then 120 else 200 end)
      returning id into v_appt;
      update public.booking_requests set status = 'confirmed', processed_at = now() where id = r.id;
      out_status := 'confirmed'; out_appointment_id := v_appt;
    else
      update public.booking_requests set status = 'declined', decline_reason = v_problem, processed_at = now() where id = r.id;
      out_status := 'declined';
    end if;
    return next;
  end loop;
end;
$$;
revoke all on function public.process_booking_requests() from public, anon, authenticated;
grant execute on function public.process_booking_requests() to service_role;

-- Safety net: every minute, only if something is waiting.
select cron.schedule('process-bookings', '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'project_url') || '/functions/v1/process-bookings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.booking_requests where status = 'new');
  $$);
