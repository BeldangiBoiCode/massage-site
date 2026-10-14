-- Loyalty points. A customer earns points ONLY when their visit is marked "done" (by Nikesh or the front desk, meaning
-- they showed up) AND it is paid in full. 1 point per dollar of the session price (tips and add-ons-free: price only).
-- Points are a ledger: earned rows are created by the database, never by the browser. NOT applied automatically.

create table public.loyalty_points (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id bigint unique references public.appointments(id) on delete set null,  -- one award per visit
  points int not null check (points <> 0),                                              -- negative = redeemed / adjusted
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now()
);
alter table public.loyalty_points enable row level security;
create index on public.loyalty_points (user_id, created_at desc);
create policy "customer reads own points" on public.loyalty_points for select using (user_id = auth.uid());
create policy "admin all points"           on public.loyalty_points for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.loyalty_points from anon;
-- Customers have no insert/update/delete policy, so they can only read their own rows. Only the owner can adjust.

-- Award (or take back) the points for one visit, based on its current status and payments.
create or replace function public.sync_loyalty(p_appt bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; paid numeric;
begin
  select * into a from public.appointments where id = p_appt;
  if not found then return; end if;
  select coalesce(sum(amount), 0) into paid from public.payments where appointment_id = p_appt;
  if a.user_id is not null and a.status = 'done' and coalesce(a.price, 0) > 0 and paid >= a.price then
    insert into public.loyalty_points (user_id, appointment_id, points, reason)
    values (a.user_id, a.id, floor(a.price)::int, 'Completed and paid visit')
    on conflict (appointment_id) do nothing;
  else
    -- no longer done / no longer fully paid: take the visit's points back
    delete from public.loyalty_points where appointment_id = p_appt and points > 0;
  end if;
end;
$$;

create or replace function public.loyalty_after_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.sync_loyalty(new.id); return null; end; $$;
create or replace function public.loyalty_after_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.sync_loyalty(coalesce(new.appointment_id, old.appointment_id)); return null; end; $$;

create trigger appointments_loyalty after insert or update of status, price on public.appointments
  for each row execute function public.loyalty_after_appointment();
create trigger payments_loyalty after insert or update or delete on public.payments
  for each row execute function public.loyalty_after_payment();

revoke execute on function public.sync_loyalty(bigint), public.loyalty_after_appointment(), public.loyalty_after_payment() from public, anon, authenticated;

-- Give points for visits that were already done and paid before this existed.
select public.sync_loyalty(id) from public.appointments where status = 'done';
