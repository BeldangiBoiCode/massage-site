-- Every session gets its full length (60 or 90 min) and then a 15 minute break before the next client.
-- Sessions can start on any quarter hour, so a 9:00 90-minute session (ends 10:30) lets the next start at 10:45.
-- Replaces the 20 minute break / on-the-half-hour rule from earlier migrations. NOT applied automatically.

create or replace function public.busy_slots(d date)
returns table (start_time time, duration_min int, buffer_min int)
language sql stable security definer set search_path = '' as $$
  with day as (
    select d::timestamp at time zone 'America/New_York' as s,
           (d + 1)::timestamp at time zone 'America/New_York' as e
  ), blocks as (
    select a.starts_at as s, a.starts_at + make_interval(mins => a.duration_min) as e, 15 as buf
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
  if extract(minute from v_local) not in (0, 15, 30, 45) then return 'Pick a start time on a quarter hour.'; end if;
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
                    && tstzrange(p_start - interval '15 minutes', v_end + interval '15 minutes'))
     or exists (select 1 from public.external_busy b where tstzrange(b.starts_at, b.ends_at) && tstzrange(p_start, v_end)) then
    return 'That time is already booked.';
  end if;
  return null;
end;
$$;

-- The no-double-booking guard uses the same 15 minute break.
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
