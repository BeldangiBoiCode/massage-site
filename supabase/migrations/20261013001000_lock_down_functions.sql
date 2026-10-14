-- Security advisor follow-up: functions that don't need to be callable by the public.
revoke all on function public.my_appointments() from public, anon;
grant execute on function public.my_appointments() to authenticated;

-- rls_auto_enable() is a Supabase platform helper; it only exists on some projects.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
