-- Customer <-> Nikesh chat, and private CRM notes.

-- One thread per customer account (customer_id). Guests without an account are reached by call/text/email.
create table public.messages (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('customer', 'admin')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index on public.messages (customer_id, created_at);
create index on public.messages (created_at desc);

-- Customers: read their own thread, write only as themselves ('customer').
create policy "customer reads own thread" on public.messages for select
  using (customer_id = auth.uid());
create policy "customer writes own message" on public.messages for insert
  with check (customer_id = auth.uid() and sender = 'customer');
-- Admin: everything.
create policy "admin all messages" on public.messages for all
  using (public.is_admin()) with check (public.is_admin());
-- Customers may mark Nikesh's messages as read. Column grants below limit this to read_at only.
create policy "customer marks admin messages read" on public.messages for update
  using (customer_id = auth.uid() and sender = 'admin') with check (customer_id = auth.uid() and sender = 'admin');

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;
revoke all on public.messages from anon;

-- Spam guard: a customer can send at most 30 messages an hour.
create or replace function public.limit_customer_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sender = 'customer' and (
       select count(*) from public.messages m
        where m.customer_id = new.customer_id and m.sender = 'customer' and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You''re sending messages very quickly. Please wait a little.';
  end if;
  return new;
end;
$$;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.limit_customer_messages();
revoke execute on function public.limit_customer_messages() from public, anon, authenticated;

-- Live updates for chat (RLS still applies to what each person receives).
alter publication supabase_realtime add table public.messages;

-- Private notes Nikesh keeps about a customer. Key = account id, or the phone digits for guests.
create table public.customer_notes (
  customer_key text primary key check (char_length(customer_key) between 1 and 80),
  note text not null default '' check (char_length(note) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.customer_notes enable row level security;
create policy "admin all customer notes" on public.customer_notes for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.customer_notes from anon;
