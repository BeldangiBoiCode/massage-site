-- Namaste Nirvana: profiles, bookings, admin access, reminder queue.
-- RLS on every table. Only rows in `admins` can see everything.

-- Admins ---------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create policy "admins read admins" on public.admins for select using (public.is_admin());

-- Customer profiles ----------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  birthday date,
  pressure_pref text check (pressure_pref in ('light','medium','firm')),
  health_notes text,
  sms_reminders boolean not null default true,
  email_reminders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "own profile update" on public.profiles for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Make a profile row for every new sign-up (Google, Apple or email).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Booking requests (public form) ---------------------------------------
create table public.booking_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  phone text not null check (char_length(phone) between 7 and 30),
  email text,
  service text not null,
  duration_min int not null default 60 check (duration_min in (60, 90, 120)),
  preferred_date date not null,
  notes text check (char_length(notes) <= 2000),
  status text not null default 'new' check (status in ('new','confirmed','declined')),
  created_at timestamptz not null default now()
);
alter table public.booking_requests enable row level security;

-- Anyone may submit; a signed-in user can only attach their own id.
create policy "anyone can request" on public.booking_requests for insert
  with check (status = 'new' and (user_id is null or user_id = auth.uid()));
create policy "own or admin read" on public.booking_requests for select
  using ((user_id is not null and user_id = auth.uid()) or public.is_admin());
create policy "admin update" on public.booking_requests for update using (public.is_admin());
create policy "admin delete" on public.booking_requests for delete using (public.is_admin());

-- Appointments (confirmed visits, admin managed) -----------------------
create table public.appointments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  booking_id bigint references public.booking_requests(id) on delete set null,
  client_name text not null,
  client_phone text,
  client_email text,
  service text not null,
  starts_at timestamptz not null,
  duration_min int not null default 60,
  price numeric(8,2),
  status text not null default 'scheduled' check (status in ('scheduled','done','cancelled','no_show')),
  therapist_notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.appointments enable row level security;

create policy "admin all appointments" on public.appointments for all
  using (public.is_admin()) with check (public.is_admin());
-- Clients see their own visits through this function, without therapist_notes.
create or replace function public.my_appointments()
returns table (id bigint, service text, starts_at timestamptz, duration_min int, price numeric, status text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.service, a.starts_at, a.duration_min, a.price, a.status
  from public.appointments a where a.user_id = auth.uid() order by a.starts_at desc;
$$;
revoke execute on function public.my_appointments() from anon;

-- Notification log (written by the reminder function) ------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  appointment_id bigint references public.appointments(id) on delete cascade,
  channel text not null check (channel in ('email','sms')),
  sent_to text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "admin read notifications" on public.notifications for select using (public.is_admin());

create index on public.booking_requests (created_at desc);
create index on public.appointments (starts_at);
