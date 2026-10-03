insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'published-media',
  'published-media',
  false,
  20000000,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy published_media_upload_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'published-media'
    and owner_id = (select auth.uid())::text
    and split_part(name, '/', 1) = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[a-f0-9]{64}$'
  );

create function public.published_media_read_allowed(
  p_version_id text,
  p_owner_id text,
  p_media_id text,
  p_share_token_hash text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.published_knowledge_area_versions version
    where version.id::text = p_version_id
      and version.owner_id::text = p_owner_id
      and (
        version.visibility = 'public'
        or (
          version.visibility = 'unlisted'
          and version.share_token_hash = p_share_token_hash
          and p_share_token_hash ~ '^[a-f0-9]{64}$'
        )
      )
      and exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(version.content -> 'cards') = 'array'
            then version.content -> 'cards' else '[]'::jsonb end
        ) card
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(card.value -> 'media') = 'array'
            then card.value -> 'media' else '[]'::jsonb end
        ) reference
        where reference.value ->> 'id' = p_media_id
      )
  )
$$;

revoke all on function public.published_media_read_allowed(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.published_media_read_allowed(text, text, text, text)
  to anon, authenticated;

create policy published_media_read_owner_or_shared on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'published-media'
    and (
      owner_id = (select auth.uid())::text
      or public.published_media_read_allowed(
        coalesce(
          (select current_setting('request.headers', true)::jsonb ->> 'x-recall-publication-version-id'),
          ''
        ),
        split_part(storage.objects.name, '/', 1),
        split_part(storage.objects.name, '/', 2),
        coalesce(
          (select current_setting('request.headers', true)::jsonb ->> 'x-recall-share-token-hash'),
          ''
        )
      )
    )
  );

create policy published_media_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'published-media'
    and owner_id = (select auth.uid())::text
  );

create function public.read_unlisted_knowledge_area_version_for_media(
  p_version_id uuid,
  p_share_token_hash text
)
returns table (
  id uuid,
  owner_id uuid,
  content jsonb,
  content_hash text,
  visibility text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select version.id, version.owner_id, version.content, version.content_hash, version.visibility
  from public.published_knowledge_area_versions version
  where version.id = p_version_id
    and version.visibility = 'unlisted'
    and version.share_token_hash = p_share_token_hash
    and p_share_token_hash ~ '^[a-f0-9]{64}$'
$$;

revoke all on function public.read_unlisted_knowledge_area_version_for_media(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_unlisted_knowledge_area_version_for_media(uuid, text)
  to anon, authenticated;
