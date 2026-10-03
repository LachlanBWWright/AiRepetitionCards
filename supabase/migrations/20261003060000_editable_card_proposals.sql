drop function public.resolve_card_proposal(uuid, text);

create function public.resolve_card_proposal(
  p_proposal_id uuid,
  p_state text,
  p_content jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_session_id uuid;
begin
  if p_state not in ('approved', 'rejected') then
    return false;
  end if;
  if p_state = 'approved' and p_content is not null and (
    jsonb_typeof(p_content) <> 'object'
    or coalesce(jsonb_typeof(p_content->'front'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'front')), 0) not between 1 and 1000
    or coalesce(jsonb_typeof(p_content->'back'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'back')), 0) not between 1 and 3000
    or coalesce(jsonb_typeof(p_content->'rationale'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'rationale')), 0) not between 1 and 1000
    or not (p_content ? 'objectiveId')
    or (p_content->'objectiveId' <> 'null'::jsonb and coalesce(jsonb_typeof(p_content->'objectiveId'), '') <> 'string')
  ) then
    return false;
  end if;

  update public.generated_card_proposals
  set state = p_state,
      content = case
        when p_state = 'approved' and p_content is not null then p_content
        else content
      end,
      resolved_at = now()
  where id = p_proposal_id
    and user_id = (select auth.uid())
    and state = 'pending'
  returning session_id into resolved_session_id;
  if not found then
    return false;
  end if;
  update public.tutor_sessions
  set last_proposal_id = null, updated_at = now()
  where id = resolved_session_id and user_id = (select auth.uid());
  return true;
end;
$$;
revoke all on function public.resolve_card_proposal(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.resolve_card_proposal(uuid, text, jsonb) to authenticated;
