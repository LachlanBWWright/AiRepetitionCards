create table public.published_knowledge_area_versions (
  id uuid primary key,
  source_area_id uuid references public.knowledge_areas (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  version integer not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  visibility text not null check (visibility in ('private', 'unlisted', 'public')),
  attribution text check (attribution is null or char_length(attribution) <= 500),
  license text check (license is null or char_length(license) <= 120),
  forked_from_version_id uuid references public.published_knowledge_area_versions (id) on delete set null,
  share_token_hash text check (share_token_hash is null or share_token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_area_id, version),
  check ((visibility = 'unlisted') = (share_token_hash is not null))
);

create index published_knowledge_area_public_idx
  on public.published_knowledge_area_versions (created_at desc)
  where visibility = 'public';
create index published_knowledge_area_owner_idx
  on public.published_knowledge_area_versions (owner_id, created_at desc);

alter table public.published_knowledge_area_versions enable row level security;
revoke all on public.published_knowledge_area_versions from public, anon, authenticated;
grant select (
  id, source_area_id, owner_id, version, content, content_hash, visibility,
  attribution, license, forked_from_version_id, created_by, created_at
) on public.published_knowledge_area_versions to anon, authenticated;
grant insert (
  id, source_area_id, owner_id, version, content, content_hash, visibility,
  attribution, license, forked_from_version_id, share_token_hash, created_by
) on public.published_knowledge_area_versions to authenticated;

create policy published_areas_read_public on public.published_knowledge_area_versions
  for select to anon, authenticated using (visibility = 'public');
create policy published_areas_read_owner on public.published_knowledge_area_versions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy published_areas_create_owner on public.published_knowledge_area_versions
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and created_by = (select auth.uid())
    and (source_area_id is null or exists (
      select 1 from public.knowledge_areas area
      where area.id = source_area_id and area.owner_id = (select auth.uid())
    ))
    and (forked_from_version_id is null or exists (
      select 1 from public.published_knowledge_area_versions source_version
      where source_version.id = forked_from_version_id
    ))
  );

create function public.read_unlisted_knowledge_area_version(
  p_version_id uuid,
  p_share_token_hash text
)
returns table (
  id uuid,
  source_area_id uuid,
  version integer,
  content jsonb,
  content_hash text,
  attribution text,
  license text,
  forked_from_version_id uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select version.id, version.source_area_id, version.version, version.content,
         version.content_hash, version.attribution, version.license,
         version.forked_from_version_id, version.created_at
  from public.published_knowledge_area_versions version
  where version.id = p_version_id
    and version.visibility = 'unlisted'
    and version.share_token_hash = p_share_token_hash
    and p_share_token_hash ~ '^[a-f0-9]{64}$'
$$;

revoke all on function public.read_unlisted_knowledge_area_version(uuid, text) from public, anon, authenticated;
grant execute on function public.read_unlisted_knowledge_area_version(uuid, text) to anon, authenticated;

comment on table public.published_knowledge_area_versions is
  'Immutable portable Knowledge Area snapshots. Contains no learner schedule, review, tutor, or observation data.';
comment on column public.published_knowledge_area_versions.content_hash is
  'SHA-256 of canonical portable Knowledge Area content, computed by the publishing application.';
comment on column public.published_knowledge_area_versions.share_token_hash is
  'SHA-256 digest of an unlisted share bearer token; excluded from client SELECT privileges.';
comment on column public.published_knowledge_area_versions.forked_from_version_id is
  'Immutable source snapshot lineage for an independent fork.';
