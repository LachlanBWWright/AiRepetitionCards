create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text check (handle is null or char_length(handle) <= 40),
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_areas (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text,
  language text not null default 'en',
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  tags text[] not null default '{}',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_area_versions (
  id uuid primary key,
  knowledge_area_id uuid not null references public.knowledge_areas (id) on delete cascade,
  version integer not null check (version > 0),
  parent_version_id uuid,
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (knowledge_area_id, version),
  unique (knowledge_area_id, content_hash),
  unique (knowledge_area_id, id),
  foreign key (knowledge_area_id, parent_version_id)
    references public.knowledge_area_versions (knowledge_area_id, id)
);

create table public.learning_objectives (
  id uuid primary key,
  knowledge_area_id uuid not null references public.knowledge_areas (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_area_id, id)
);

create table public.objective_prerequisites (
  knowledge_area_id uuid not null,
  objective_id uuid not null,
  prerequisite_id uuid not null,
  primary key (objective_id, prerequisite_id),
  check (objective_id <> prerequisite_id),
  foreign key (knowledge_area_id, objective_id)
    references public.learning_objectives (knowledge_area_id, id) on delete cascade,
  foreign key (knowledge_area_id, prerequisite_id)
    references public.learning_objectives (knowledge_area_id, id) on delete cascade
);

create table public.cards (
  id uuid primary key,
  knowledge_area_id uuid not null references public.knowledge_areas (id) on delete cascade,
  current_revision integer not null default 1 check (current_revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_area_id, id)
);

create table public.card_revisions (
  id uuid primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  revision integer not null check (revision > 0),
  base_revision_id uuid,
  content jsonb not null,
  provenance text not null check (char_length(provenance) between 1 and 120),
  creator_type text not null check (creator_type in ('learner', 'import', 'ai')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (card_id, revision),
  unique (card_id, id),
  foreign key (card_id, base_revision_id)
    references public.card_revisions (card_id, id)
);

alter table public.cards
  add constraint cards_current_revision_fk
  foreign key (id, current_revision)
  references public.card_revisions (card_id, revision)
  deferrable initially deferred;

create table public.card_objectives (
  knowledge_area_id uuid not null,
  card_id uuid not null,
  objective_id uuid not null,
  primary key (card_id, objective_id),
  foreign key (knowledge_area_id, card_id)
    references public.cards (knowledge_area_id, id) on delete cascade,
  foreign key (knowledge_area_id, objective_id)
    references public.learning_objectives (knowledge_area_id, id) on delete cascade
);

create table public.review_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete restrict,
  device_id uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  base_review_event_id uuid references public.review_events (id),
  reviewed_at_device timestamptz not null,
  effective_reviewed_at timestamptz not null,
  received_at_server timestamptz not null default now(),
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0),
  scheduler_family text not null check (scheduler_family = 'fsrs'),
  scheduler_version text not null,
  scheduler_parameter_set_id text,
  previous_state_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, device_id, device_sequence),
  unique (user_id, card_id, id),
  foreign key (user_id, card_id, base_review_event_id)
    references public.review_events (user_id, card_id, id)
);

create table public.scheduling_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  scheduler_family text not null check (scheduler_family = 'fsrs'),
  scheduler_version text not null,
  last_review_event_id uuid,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id),
  foreign key (user_id, card_id, last_review_event_id)
    references public.review_events (user_id, card_id, id)
    deferrable initially deferred
);

create table public.sync_changes (
  sequence bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null,
  entity_type text not null check (char_length(entity_type) between 1 and 40),
  entity_id uuid not null,
  operation text not null check (operation in ('upsert', 'tombstone')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id)
);

create function public.enqueue_review_sync_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.sync_changes (
    user_id, operation_id, entity_type, entity_id, operation, payload
  ) values (
    new.user_id, new.id, 'review_event', new.id, 'upsert', to_jsonb(new)
  ) on conflict (user_id, operation_id) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_review_sync_change() from public, anon, authenticated;
create trigger review_events_enqueue_sync_change
  after insert on public.review_events
  for each row execute function public.enqueue_review_sync_change();

create index knowledge_areas_owner_updated_idx
  on public.knowledge_areas (owner_id, updated_at desc);
create index cards_area_idx on public.cards (knowledge_area_id) where deleted_at is null;
create index review_events_user_time_idx
  on public.review_events (user_id, effective_reviewed_at desc);
create index review_events_card_time_idx
  on public.review_events (card_id, effective_reviewed_at);
create index sync_changes_user_sequence_idx on public.sync_changes (user_id, sequence);

alter table public.profiles enable row level security;
alter table public.knowledge_areas enable row level security;
alter table public.knowledge_area_versions enable row level security;
alter table public.learning_objectives enable row level security;
alter table public.objective_prerequisites enable row level security;
alter table public.cards enable row level security;
alter table public.card_revisions enable row level security;
alter table public.card_objectives enable row level security;
alter table public.review_events enable row level security;
alter table public.scheduling_state enable row level security;
alter table public.sync_changes enable row level security;

revoke all on public.profiles, public.knowledge_areas, public.knowledge_area_versions,
  public.learning_objectives, public.objective_prerequisites, public.cards,
  public.card_revisions, public.card_objectives, public.review_events,
  public.scheduling_state, public.sync_changes from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.knowledge_areas to authenticated;
grant select, insert on public.knowledge_area_versions to authenticated;
grant select, insert, update, delete on public.learning_objectives to authenticated;
grant select, insert, delete on public.objective_prerequisites to authenticated;
grant select, insert, update on public.cards to authenticated;
grant select, insert on public.card_revisions to authenticated;
grant select, insert, delete on public.card_objectives to authenticated;
grant select, insert on public.review_events to authenticated;
grant select, insert, update, delete on public.scheduling_state to authenticated;
grant select on public.sync_changes to authenticated;

create policy profiles_read_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_create_own on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy knowledge_areas_read_owner on public.knowledge_areas
  for select to authenticated using (owner_id = (select auth.uid()));
create policy knowledge_areas_create_owner on public.knowledge_areas
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy knowledge_areas_update_owner on public.knowledge_areas
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy area_versions_read_owner on public.knowledge_area_versions
  for select to authenticated using (
    exists (select 1 from public.knowledge_areas area
      where area.id = knowledge_area_id and area.owner_id = (select auth.uid()))
  );
create policy area_versions_create_owner on public.knowledge_area_versions
  for insert to authenticated with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public.knowledge_areas area
      where area.id = knowledge_area_id and area.owner_id = (select auth.uid())
    )
  );

create policy objectives_owner_all on public.learning_objectives
  for all to authenticated
  using (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())));
create policy prerequisites_owner_all on public.objective_prerequisites
  for all to authenticated
  using (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())));

create policy cards_owner_all on public.cards
  for all to authenticated
  using (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())));
create policy card_revisions_owner_read on public.card_revisions
  for select to authenticated using (
    exists (select 1 from public.cards card
      join public.knowledge_areas area on area.id = card.knowledge_area_id
      where card.id = card_revisions.card_id and area.owner_id = (select auth.uid()))
  );
create policy card_revisions_owner_create on public.card_revisions
  for insert to authenticated with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public.cards card
      join public.knowledge_areas area on area.id = card.knowledge_area_id
      where card.id = card_revisions.card_id and area.owner_id = (select auth.uid())
    )
  );
create policy card_objectives_owner_all on public.card_objectives
  for all to authenticated
  using (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.knowledge_areas area
    where area.id = knowledge_area_id and area.owner_id = (select auth.uid())));

create policy review_events_read_own on public.review_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy review_events_create_own on public.review_events
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.cards card
      join public.knowledge_areas area on area.id = card.knowledge_area_id
      where card.id = card_id and card.deleted_at is null and area.deleted_at is null
        and area.owner_id = (select auth.uid())
    )
  );

create policy scheduling_state_own_all on public.scheduling_state
  for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.cards card
    join public.knowledge_areas area on area.id = card.knowledge_area_id
    where card.id = card_id and area.owner_id = (select auth.uid())
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.cards card
    join public.knowledge_areas area on area.id = card.knowledge_area_id
    where card.id = card_id and area.owner_id = (select auth.uid())
  ));
create policy sync_changes_read_own on public.sync_changes
  for select to authenticated using (user_id = (select auth.uid()));

comment on table public.review_events is 'Append-only personal review history; never included in published Knowledge Area content.';
comment on table public.scheduling_state is 'Rebuildable per-user cache derived from review_events.';
comment on table public.knowledge_area_versions is 'Immutable portable snapshots; publication and public-read policies are added with sharing.';
