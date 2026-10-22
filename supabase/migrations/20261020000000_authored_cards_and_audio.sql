-- Audio containers emitted by native and browser pronunciation recorders.
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/ogg','audio/wav','audio/mp4','audio/webm'
] where id in ('published-media');

create or replace function public.sync_workspace_study(p_revision integer, p_document jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare current_row public.workspace_study; field text;
begin
  if auth.uid() is null or p_revision is null or p_revision < 0 or p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or octet_length(p_document::text) > 5000000 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 761));
  select * into current_row from public.workspace_study where owner_id = auth.uid() for update;
  if coalesce(current_row.revision, 0) <> p_revision then return null; end if;
  foreach field in array array['adjustments', 'corrections', 'undoStates', 'importedSchedules'] loop
    if jsonb_typeof(coalesce(p_document->field, '[]'::jsonb)) is distinct from 'array' then return null; end if;
    if current_row.document is not null and exists (
      select value from jsonb_array_elements(coalesce(current_row.document->field, '[]'::jsonb))
      except select value from jsonb_array_elements(coalesce(p_document->field, '[]'::jsonb))
    ) then return null; end if;
  end loop;
  if jsonb_typeof(p_document->'settings') is distinct from 'object' then return null; end if;
  insert into public.workspace_study(owner_id, revision, document)
    values(auth.uid(), p_revision + 1, p_document)
    on conflict(owner_id) do update set revision = excluded.revision, document = excluded.document;
  return jsonb_build_object('revision', p_revision + 1, 'document', p_document);
end;
$$;
revoke all on function public.sync_workspace_study(integer, jsonb) from public, anon;
grant execute on function public.sync_workspace_study(integer, jsonb) to authenticated;


-- Shared source notes can own media not currently displayed by a generated card.
create or replace function public.published_media_read_allowed(
  p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.published_knowledge_area_versions v
    join public.shared_decks d on d.deck_id = v.source_area_id
    where v.id::text = p_version_id and v.owner_id::text = p_owner_id
      and (auth.uid() = d.owner_id or
        d.status = 'active' and d.moderation_status = 'visible' and
        (v.visibility = 'public' or v.visibility = 'unlisted'
          and v.share_token_hash = p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'))
      and exists (
        select 1 from jsonb_array_elements(
          (case when jsonb_typeof(v.content->'cards') = 'array' then v.content->'cards' else '[]'::jsonb end)
          || (case when jsonb_typeof(v.content->'noteLibrary'->'notes') = 'array'
            then v.content->'noteLibrary'->'notes' else '[]'::jsonb end)
        ) source
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(source.value->'media') = 'array'
            then source.value->'media' else '[]'::jsonb end
        ) media where media.value->>'id' = p_media_id
      )
  );
$$;
