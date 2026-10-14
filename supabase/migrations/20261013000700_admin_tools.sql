-- Admin tools: payments, discount codes, and customer reviews.

-- Payments Nikesh records by hand (cash, card reader, Venmo, Zelle...). No payment processor yet.
create table public.payments (
  id bigint generated always as identity primary key,
  appointment_id bigint references public.appointments(id) on delete cascade,
  amount numeric(8,2) not null check (amount > 0 and amount < 10000),
  method text not null default 'cash' check (method in ('cash', 'card', 'venmo', 'zelle', 'other')),
  note text check (char_length(note) <= 300),
  paid_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create policy "admin all payments" on public.payments for all
  using (public.is_admin()) with check (public.is_admin());
create index on public.payments (appointment_id);

-- Discount codes Nikesh creates and sends (by text or email link). Redeemed by hand.
create table public.discounts (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9-]{4,24}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(6,2) not null check (value > 0 and (kind = 'amount' or value <= 100)),
  customer_name text,
  customer_contact text,
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.discounts enable row level security;
create policy "admin all discounts" on public.discounts for all
  using (public.is_admin()) with check (public.is_admin());

-- Reviews: written to by the submit-review edge function only (service role). New ones wait for approval.
create table public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 10 and 1500),
  service text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create policy "admin all reviews" on public.reviews for all
  using (public.is_admin()) with check (public.is_admin());
create index on public.reviews (status, created_at desc);

-- What the public may read: approved reviews only, first name + last initial.
create or replace function public.public_reviews()
returns table (name text, rating smallint, body text, service text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select case when position(' ' in btrim(r.name)) > 0
              then split_part(btrim(r.name), ' ', 1) || ' ' || left(substring(btrim(r.name) from '[^ ]+$'), 1) || '.'
              else btrim(r.name) end,
         r.rating, r.body, r.service, r.created_at
    from public.reviews r
   where r.status = 'approved'
   order by r.created_at desc
   limit 50
$$;
grant execute on function public.public_reviews() to anon, authenticated;
