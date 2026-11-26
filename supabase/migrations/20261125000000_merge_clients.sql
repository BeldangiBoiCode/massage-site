-- Admin tool: merge two client records that are the same person (e.g. a guest booking with only a phone
-- and an account with an email). Everything runs in one function call, so it all moves or nothing does.
-- Client "keys" match buildCustomers() in admin.html: an account is its user id; a guest is
-- phone digits, else lowercased email, else 'x' || appointment id.

-- A merged-away account stays (we never delete logins from the browser) but is hidden from the client list.
alter table public.profiles add column if not exists merged_into uuid references auth.users(id) on delete set null;

-- Every merge is logged with the old values, so a mistake can be checked and fixed by hand.
create table if not exists public.client_merges (
  id bigint generated always as identity primary key,
  merged_at timestamptz not null default now(),
  merged_by uuid references auth.users(id) on delete set null default auth.uid(),
  keep_key text not null,
  from_key text not null,
  kept jsonb not null,
  before jsonb not null
);
alter table public.client_merges enable row level security;
create policy "admin reads merges" on public.client_merges for select using (public.is_admin());
revoke all on public.client_merges from anon, authenticated;
grant select on public.client_merges to authenticated;

-- Appointment ids that belong to one client key (same grouping as the admin page).
create or replace function public._client_appt_ids(p_key text)
returns bigint[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(a.id), '{}')
  from public.appointments a
  where (
    p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
    and (
      a.user_id::text = p_key
      -- guest bookings whose phone matches the account's phone show under the account too
      or (a.user_id is null
          and nullif(regexp_replace(coalesce(a.client_phone, ''), '\D', '', 'g'), '') =
              (select nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') from public.profiles p where p.id::text = p_key))
    )
  ) or (
    p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
    and a.user_id is null
    and coalesce(nullif(regexp_replace(coalesce(a.client_phone, ''), '\D', '', 'g'), ''), nullif(lower(a.client_email), ''), 'x' || a.id) = p_key
  );
$$;
revoke all on function public._client_appt_ids(text) from public, anon, authenticated;

-- Merges client p_from into client p_keep and sets the kept name / phone / email.
-- If either side has an account, the account must be p_keep (the page picks that for you).
create or replace function public.merge_clients(p_keep text, p_from text, p_name text, p_phone text, p_email text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  keep_uid uuid;
  from_uid uuid;
  ids bigint[];
  new_key text;
  keep_note text;
  from_note text;
  merged_note text;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if p_keep is null or p_from is null or p_keep = p_from then
    raise exception 'Pick two different clients.';
  end if;

  p_name := nullif(btrim(p_name), '');
  p_phone := nullif(btrim(p_phone), '');
  p_email := nullif(lower(btrim(p_email)), '');
  if p_name is null then
    raise exception 'A name is needed.';
  end if;

  if p_keep ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' then
    select id into keep_uid from public.profiles where id::text = p_keep;
  end if;
  if p_from ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' then
    select id into from_uid from public.profiles where id::text = p_from;
  end if;
  if keep_uid is null and from_uid is not null then
    raise exception 'Keep the client who has an account.';
  end if;
  if keep_uid is null and p_phone is null and p_email is null then
    raise exception 'Keep a phone or an email so the bookings stay together.';
  end if;

  ids := public._client_appt_ids(p_keep) || public._client_appt_ids(p_from);

  -- Log first, with the values as they were.
  insert into public.client_merges (keep_key, from_key, kept, before)
  values (
    p_keep, p_from,
    jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email),
    jsonb_build_object(
      'appointments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'client_name', a.client_name,
                        'client_phone', a.client_phone, 'client_email', a.client_email)), '[]'::jsonb)
                       from public.appointments a where a.id = any(ids)),
      'keep_profile', (select jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'email', p.email) from public.profiles p where p.id = keep_uid),
      'from_profile', (select jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'email', p.email) from public.profiles p where p.id = from_uid)
    )
  );

  -- All their bookings get the kept contact details (and the account, if there is one).
  update public.appointments
  set user_id = coalesce(keep_uid, user_id), client_name = p_name, client_phone = p_phone, client_email = p_email
  where id = any(ids);

  if keep_uid is not null then
    update public.profiles
    set full_name = p_name, phone = coalesce(p_phone, phone), email = coalesce(p_email, email), updated_at = now()
    where id = keep_uid;

    if from_uid is not null then
      update public.booking_requests set user_id = keep_uid where user_id = from_uid;
      update public.messages set customer_id = keep_uid where customer_id = from_uid;
      update public.loyalty_points set user_id = keep_uid where user_id = from_uid;
      update public.reviews set user_id = keep_uid where user_id = from_uid;
      update public.suggestions set user_id = keep_uid where user_id = from_uid;
      update public.profiles set merged_into = keep_uid, updated_at = now() where id = from_uid;
    end if;

    -- A guest's chat thread moves onto the account.
    update public.messages set customer_id = keep_uid, guest_key = null where guest_key = 'g:' || p_from;

    -- Old guest visits that were done and paid now earn points on the account.
    perform public.sync_loyalty(x) from unnest(ids) as x;
    new_key := keep_uid::text;
  else
    -- Two guests: the kept phone (or email) becomes their key, so the chat threads follow it.
    new_key := coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), p_email);
    update public.messages set guest_key = 'g:' || new_key where guest_key in ('g:' || p_keep, 'g:' || p_from);
  end if;

  -- Private notes: keep both, one under the other.
  select note into keep_note from public.customer_notes where customer_key = p_keep;
  select note into from_note from public.customer_notes where customer_key = p_from;
  merged_note := left(concat_ws(E'\n---\n', nullif(keep_note, ''), nullif(from_note, '')), 4000);
  delete from public.customer_notes where customer_key in (p_keep, p_from);
  if merged_note <> '' then
    insert into public.customer_notes (customer_key, note, updated_at)
    values (new_key, merged_note, now())
    on conflict (customer_key) do update
      set note = left(concat_ws(E'\n---\n', public.customer_notes.note, excluded.note), 4000), updated_at = now();
  end if;

  return jsonb_build_object('key', new_key, 'appointments', coalesce(array_length(ids, 1), 0));
end;
$$;
revoke all on function public.merge_clients(text, text, text, text, text) from public, anon;
grant execute on function public.merge_clients(text, text, text, text, text) to authenticated;
