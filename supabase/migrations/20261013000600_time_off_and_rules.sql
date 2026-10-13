-- Aligns the booking backend with the site: 60/90 min sessions, starts on :00/:30, 20 min break
-- between sessions, add-ons, and Nikesh's time off (breaks / vacation days that block booking).

-- Time off ------------------------------------------------------------
create table public.time_off (
  id bigint generated always as identity primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.time_off enable row level security;
create policy "admin all time off" on public.time_off for all
  using (public.is_admin()) with check (public.is_admin());
create index on public.time_off (starts_at);

-- Add-ons and session lengths -----------------------------------------
alter table public.booking_requests add column if not exists addons text[] not null default '{}';
alter table public.appointments     add column if not exists addons text[] not null default '{}';
alter table public.booking_requests drop constraint if exists booking_requests_duration_min_check;
alter table public.booking_requests add constraint booking_requests_duration_min_check check (duration_min in (60, 90));

-- Public: busy blocks for one day (shop time). No names. buffer_min is the break the site
-- adds around the block (20 after/before sessions; 0 for time off and calendar events).
drop function if exists public.busy_slots(timestamptz, timestamptz);
create or replace function public.busy_slots(d date)
returns table (start_time time, duration_min int, buffer_min int)
language sql stable security definer set search_path = '' as $$
  with day as (
    select d::timestamp at time zone 'America/New_York' as s,
           (d + 1)::timestamp at time zone 'America/New_York' as e
  ), blocks as (
    select a.starts_at as s, a.starts_at + make_interval(mins => a.duration_min) as e, 20 as buf
      from public.appointments a where a.status = 'scheduled'
    union all select b.starts_at, b.ends_at, 0 from public.external_busy b
    union all select t.starts_at, t.ends_at, 0 from public.time_off t
  )
  select (greatest(b.s, day.s) at time zone 'America/New_York')::time,
         ceil(extract(epoch from (least(b.e, day.e) - greatest(b.s, day.s))) / 60)::int,
         b.buf
    from blocks b, day
   where b.s < day.e and b.e > day.s
$$;
grant execute on function public.busy_slots(date) to anon, authenticated;

-- Server-side rules (the website mirrors these but this is the real check) ----
create or replace function public.slot_problem(p_start timestamptz, p_minutes int)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_end timestamptz := p_start + make_interval(mins => p_minutes);
  v_local timestamp := p_start at time zone 'America/New_York';
  v_end_local timestamp := v_end at time zone 'America/New_York';
  h record;
begin
  if p_minutes not in (60, 90) then return 'Pick a 60 or 90 minute session.'; end if;
  if p_start < now() + interval '2 hours' then return 'Please pick a time at least 2 hours from now.'; end if;
  if p_start > now() + interval '60 days' then return 'Bookings open up to 60 days ahead.'; end if;
  if extract(minute from v_local) not in (0, 30) then return 'Pick a start time on the hour or half hour.'; end if;
  select * into h from public.opening_hours where weekday = extract(dow from v_local)::int;
  if not found or v_local::time < h.opens_at or v_end_local::time > h.closes_at or v_end_local::date <> v_local::date then
    return 'That time is outside opening hours.';
  end if;
  if exists (select 1 from public.time_off t where tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start, v_end)) then
    return 'Nikesh is away then. Pick another time.';
  end if;
  if exists (select 1 from public.appointments a
              where a.status = 'scheduled'
                and tstzrange(a.starts_at, a.starts_at + make_interval(mins => a.duration_min))
                    && tstzrange(p_start - interval '20 minutes', v_end + interval '20 minutes'))
     or exists (select 1 from public.external_busy b where tstzrange(b.starts_at, b.ends_at) && tstzrange(p_start, v_end)) then
    return 'That time is already booked.';
  end if;
  return null;
end;
$$;

-- Same as before, now with add-on pricing (+$15 cupping, +$20 TENS).
create or replace function public.process_booking_requests()
returns table (out_request_id bigint, out_status text, out_reason text, out_appointment_id bigint)
language plpgsql security definer set search_path = '' as $$
declare r record; v_start timestamptz; v_problem text; v_appt bigint; v_price numeric;
begin
  perform pg_advisory_xact_lock(7001);
  for r in select * from public.booking_requests where status = 'new' order by id limit 50 for update skip locked loop
    v_start := (r.preferred_date + r.preferred_time) at time zone 'America/New_York';
    v_problem := public.slot_problem(v_start, r.duration_min);
    out_request_id := r.id; out_reason := v_problem; out_appointment_id := null;
    if v_problem is null then
      v_price := case r.duration_min when 60 then 85 else 120 end
               + case when 'Cupping' = any (r.addons) then 15 else 0 end
               + case when 'TENS machine' = any (r.addons) then 20 else 0 end;
      insert into public.appointments (user_id, booking_id, client_name, client_phone, client_email, service, starts_at, duration_min, price, addons)
      values (r.user_id, r.id, r.name, r.phone, r.email, r.service, v_start, r.duration_min, v_price, r.addons)
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
