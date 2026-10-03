create function public.erase_account_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if p_user_id is null or (select auth.role()) <> 'service_role' then
    return false;
  end if;

  update public.review_events
  set base_review_event_id = null
  where user_id = p_user_id and base_review_event_id is not null;
  delete from public.scheduling_state where user_id = p_user_id;
  delete from public.review_events where user_id = p_user_id;
  delete from public.tutor_sessions where user_id = p_user_id;
  delete from public.tutor_ai_usage_events where user_id = p_user_id;
  delete from public.sync_changes where user_id = p_user_id;
  delete from public.knowledge_areas where owner_id = p_user_id;
  delete from public.profiles where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.erase_account_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_account_data(uuid) to service_role;

comment on function public.erase_account_data(uuid) is
  'Erases a single account''s user data before the Auth Admin API deletes the user identity.';
