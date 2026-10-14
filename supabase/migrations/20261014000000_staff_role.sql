-- Staff role (front desk). NOT applied automatically: review, then `supabase db push`.
-- Staff can: see/make/cancel appointments, work the booking requests, see basic client contact info,
-- and set breaks/days off for the therapist (Nikesh). Staff can NOT see money, reviews, chat, notes or health info.
-- Add a staff member (after they have created an account):
--   insert into public.staff (user_id, full_name) select id, 'Front Desk Name' from auth.users where email = 'them@example.com';

create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create policy "staff read self or admin" on public.staff for select using (user_id = auth.uid() or public.is_admin());
create policy "admin manages staff" on public.staff for all using (public.is_admin()) with check (public.is_admin());

-- Appointments: read, create, update (cancel = status change). No delete.
create policy "staff read appointments"   on public.appointments for select using (public.is_staff());
create policy "staff create appointments" on public.appointments for insert with check (public.is_staff());
create policy "staff update appointments" on public.appointments for update using (public.is_staff()) with check (public.is_staff());

-- Online booking requests: read and answer.
create policy "staff read requests"   on public.booking_requests for select using (public.is_staff());
create policy "staff answer requests" on public.booking_requests for update using (public.is_staff()) with check (public.is_staff());

-- Breaks / days off for the therapist.
create policy "staff all time off" on public.time_off for all using (public.is_staff()) with check (public.is_staff());

-- Basic client info only (no health notes, birthday or preferences).
create or replace function public.staff_clients()
returns table (id uuid, full_name text, phone text, email text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.phone, p.email from public.profiles p where public.is_staff() order by p.full_name;
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
revoke all on function public.staff_clients() from public, anon;
grant execute on function public.staff_clients() to authenticated;
