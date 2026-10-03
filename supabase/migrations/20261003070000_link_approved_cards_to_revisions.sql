alter table public.generated_card_proposals
  add column approved_revision_id uuid references public.card_revisions (id) on delete set null;
create unique index generated_card_proposals_approved_card_unique
  on public.generated_card_proposals (approved_card_id)
  where approved_card_id is not null;

drop function public.resolve_card_proposal(uuid, text, jsonb);

create function public.resolve_card_proposal(
  p_proposal_id uuid,
  p_state text,
  p_content jsonb default null,
  p_card_id uuid default null
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
  if p_state = 'approved' and p_card_id is null then
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
      approved_card_id = case when p_state = 'approved' then p_card_id else null end,
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
revoke all on function public.resolve_card_proposal(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.resolve_card_proposal(uuid, text, jsonb, uuid) to authenticated;

create function public.link_approved_proposal_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.generated_card_proposals
  set approved_revision_id = new.id
  where approved_card_id = new.card_id
    and state = 'approved'
    and approved_revision_id is null;
  return new;
end;
$$;
revoke all on function public.link_approved_proposal_revision() from public, anon, authenticated;

create trigger card_revision_links_approved_proposal
  after insert on public.card_revisions
  for each row execute function public.link_approved_proposal_revision();

comment on column public.generated_card_proposals.approved_revision_id is
  'Immutable server revision created when the approved local card next synchronizes.';
