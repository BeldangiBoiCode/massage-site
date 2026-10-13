-- Server-only settings (cron token, calendar feed token, project url).
-- RLS on with NO policies: the API can never read it. Only the postgres role
-- (pg_cron) and the service role (edge functions) can. No dashboard secrets needed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('feed_token',  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict do nothing;
-- Also set once by hand:  insert into app_settings values ('project_url','https://<ref>.supabase.co');

-- Hourly: reminders for appointments in the next 24h.
select cron.schedule(
  'appointment-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_settings where key = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from public.app_settings where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
