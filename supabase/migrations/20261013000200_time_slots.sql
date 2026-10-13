-- Time slots: Sun + Mon, 9am to 8pm (America/New_York), 20 min break between sessions.

alter table public.booking_requests add column preferred_time time;

-- Busy times for a day. No personal info, so the public booking form can call it.
create or replace function public.busy_slots(d date)
returns table (start_time time, duration_min int)
language sql stable security definer set search_path = public as $$
  select preferred_time, duration_min from booking_requests
   where preferred_date = d and preferred_time is not null and status in ('new', 'confirmed')
  union all
  select (starts_at at time zone 'America/New_York')::time, duration_min from appointments
   where (starts_at at time zone 'America/New_York')::date = d and status = 'scheduled';
$$;
grant execute on function public.busy_slots(date) to anon, authenticated;

-- Reject requests outside hours or overlapping another session plus the 20 min break.
create or replace function public.check_booking_slot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.preferred_time is null then
    raise exception 'Pick a time for your session.';
  end if;
  if extract(dow from new.preferred_date) not in (0, 1) then
    raise exception 'We''re open Sunday and Monday only.';
  end if;
  if new.preferred_time < time '09:00'
     or new.preferred_time + make_interval(mins => new.duration_min) > time '20:00'
     or new.preferred_time + make_interval(mins => new.duration_min) < new.preferred_time then
    raise exception 'Sessions run between 9am and 8pm.';
  end if;
  if exists (
    select 1 from busy_slots(new.preferred_date) b
     where new.preferred_time < b.start_time + make_interval(mins => b.duration_min + 20)
       and b.start_time < new.preferred_time + make_interval(mins => new.duration_min + 20)
  ) then
    raise exception 'That time was just taken. Pick another one.';
  end if;
  return new;
end $$;

create trigger booking_slot_check before insert on public.booking_requests
  for each row execute function public.check_booking_slot();

-- 120 min option dropped: only 60 and 90 min sessions.
alter table public.booking_requests drop constraint if exists booking_requests_duration_min_check;
alter table public.booking_requests add constraint booking_requests_duration_min_check check (duration_min in (60, 90)) not valid;
