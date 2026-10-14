-- Average rating + count of approved reviews, for the home page reviews strip. Public (no personal data).
create or replace function public.review_stats()
returns table (average numeric, total bigint)
language sql stable security definer set search_path = '' as $$
  select round(avg(r.rating)::numeric, 1), count(*) from public.reviews r where r.status = 'approved'
$$;
grant execute on function public.review_stats() to anon, authenticated;
