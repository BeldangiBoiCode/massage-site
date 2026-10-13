-- Calendar: Nikesh's Google/Apple calendars -> busy times (pulled by cron),
-- and appointments -> a feed he subscribes to. Everything detailed is admin-only;
-- the public only ever sees anonymous busy time ranges.

-- Calendar links to pull (Google: "Secret address in iCal format"; Apple: public/shared calendar link).
create table public.calendar_sources (
  id bigint generated always as identity primary key,
  label text not null,
  ics_url text not null check (ics_url ~ '^(https|webcal)://'),
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.calendar_sources enable row level security;
create policy "admin all sources" on public.calendar_sources for all
  using (public.is_admin()) with check (public.is_admin());

-- Busy blocks copied from those calendars (no titles kept).
create table public.external_busy (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.calendar_sources(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);
alter table public.external_busy enable row level security;
create policy "admin read busy" on public.external_busy for select using (public.is_admin());
create index on public.external_busy (starts_at);

-- What the public may see: only WHEN it's taken, never who or what.
create or replace function public.busy_slots(from_ts timestamptz, to_ts timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.starts_at, a.starts_at + make_interval(mins => a.duration_min)
    from public.appointments a
   where a.status = 'scheduled' and a.starts_at < to_ts and a.starts_at + make_interval(mins => a.duration_min) > from_ts
  union all
  select b.starts_at, b.ends_at
    from public.external_busy b
   where b.starts_at < to_ts and b.ends_at > from_ts
  order by 1
$$;
grant execute on function public.busy_slots(timestamptz, timestamptz) to anon, authenticated;

-- Every 15 minutes: pull calendars.
select cron.schedule(
  'calendar-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'project_url') || '/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
