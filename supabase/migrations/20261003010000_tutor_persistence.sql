create table public.tutor_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  area_id text not null,
  area_title text not null check (char_length(area_title) between 1 and 80),
  area_snapshot jsonb not null,
  state text not null default 'open' check (state in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.tutor_messages (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence bigint generated always as identity,
  role text not null check (role in ('learner', 'tutor')),
  kind text not null check (kind in ('question', 'answer', 'feedback', 'proposal')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  foreign key (user_id, session_id)
    references public.tutor_sessions (user_id, id) on delete cascade
);

create table public.ai_observations (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  objective_id text,
  result text not null check (result in ('mastered', 'partial', 'incorrect', 'uncertain')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  misconception text,
  evidence_summary text not null,
  suggested_action text not null check (
    suggested_action in ('review-existing-card', 'propose-card', 'targeted-quiz', 'explain', 'none')
  ),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, session_id)
    references public.tutor_sessions (user_id, id) on delete cascade
);

create table public.generated_card_proposals (
  id uuid primary key,
  session_id uuid not null,
  observation_id uuid not null references public.ai_observations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  content jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  approved_card_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, session_id)
    references public.tutor_sessions (user_id, id) on delete cascade,
  foreign key (user_id, observation_id)
    references public.ai_observations (user_id, id) on delete cascade
);

alter table public.tutor_sessions
  add column last_observation_id uuid,
  add column last_proposal_id uuid,
  add constraint tutor_sessions_last_observation_owner_fk
    foreign key (user_id, last_observation_id)
    references public.ai_observations (user_id, id),
  add constraint tutor_sessions_last_proposal_owner_fk
    foreign key (user_id, last_proposal_id)
    references public.generated_card_proposals (user_id, id);

create index tutor_sessions_user_updated_idx
  on public.tutor_sessions (user_id, updated_at desc);
create index tutor_messages_session_sequence_idx
  on public.tutor_messages (session_id, sequence);
create index ai_observations_session_created_idx
  on public.ai_observations (session_id, created_at desc);
create index card_proposals_session_state_idx
  on public.generated_card_proposals (session_id, state, created_at desc);

alter table public.tutor_sessions enable row level security;
alter table public.tutor_messages enable row level security;
alter table public.ai_observations enable row level security;
alter table public.generated_card_proposals enable row level security;

revoke all on public.tutor_sessions, public.tutor_messages,
  public.ai_observations, public.generated_card_proposals from anon, authenticated;
grant select, insert, update on public.tutor_sessions to authenticated;
grant select, insert on public.tutor_messages to authenticated;
grant usage, select on sequence public.tutor_messages_sequence_seq to authenticated;
grant select, insert on public.ai_observations to authenticated;
grant select, insert on public.generated_card_proposals to authenticated;

create policy tutor_sessions_own on public.tutor_sessions
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy tutor_messages_own on public.tutor_messages
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy ai_observations_own on public.ai_observations
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy card_proposals_own on public.generated_card_proposals
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.resolve_card_proposal(p_proposal_id uuid, p_state text)
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
  update public.generated_card_proposals
  set state = p_state, resolved_at = now()
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
revoke all on function public.resolve_card_proposal(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_card_proposal(uuid, text) to authenticated;

comment on table public.tutor_sessions is 'Private tutor sessions and the portable content snapshot used during the session.';
comment on table public.tutor_messages is 'Private tutor dialogue; never part of a shared Knowledge Area.';
comment on table public.ai_observations is 'Typed learner evidence with confidence; observations do not directly change schedule state.';
comment on table public.generated_card_proposals is 'Private learner-reviewed proposals; approval is required before a card is created.';
