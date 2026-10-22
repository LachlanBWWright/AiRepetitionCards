-- All private content writers use the guarded entry point below.
CREATE FUNCTION public.sync_workspace_content_unchecked(p_areas jsonb, p_tombstones jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare
  area_doc jsonb;
  objective_doc jsonb;
  card_doc jsonb;
  tombstone_doc jsonb;
  v_area_id uuid;
  v_card_id uuid;
  v_objective_id uuid;
  next_revision integer;
  current_content jsonb;
  v_content_hash text;
  version_id uuid;
  latest_hash text;
  base_hash text;
  incoming_hash text;
  v_moved boolean;
begin
  if auth.uid() is null or jsonb_typeof(p_areas) <> 'array' or jsonb_typeof(p_tombstones) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_areas) > 100 then
    return false;
  end if;
  if jsonb_array_length(p_tombstones) > 2_000 then
    return false;
  end if;
  for area_doc in select value from jsonb_array_elements(p_areas) loop
    v_area_id := (area_doc->>'id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_area_id::text, 0));
    for card_doc in select value from jsonb_array_elements(area_doc->'cards') loop
      perform pg_advisory_xact_lock(hashtextextended((card_doc->>'id'), 1));
    end loop;
    for objective_doc in select value from jsonb_array_elements(area_doc->'objectives') loop
      perform pg_advisory_xact_lock(hashtextextended((objective_doc->>'id'), 2));
    end loop;
    incoming_hash := area_doc->>'contentHash';
    base_hash := area_doc->>'baseContentHash';
    select area_version.content_hash into latest_hash
      from public.knowledge_area_versions area_version
      where area_version.knowledge_area_id = v_area_id
      order by area_version.version desc limit 1;
    if latest_hash is not null
      and latest_hash is distinct from incoming_hash
      and latest_hash is distinct from base_hash then
      return false;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_areas) area_entry
    join public.knowledge_areas existing_area
      on existing_area.id = (area_entry.value->>'id')::uuid
    where existing_area.owner_id <> auth.uid()
  ) or exists (
    select 1 from jsonb_array_elements(p_areas) area_entry,
      jsonb_array_elements(area_entry.value->'cards') card_entry
    join public.cards existing_card on existing_card.id = (card_entry.value->>'id')::uuid
    where existing_card.knowledge_area_id <> (area_entry.value->>'id')::uuid
      and not exists (
        select 1 from jsonb_array_elements(p_areas) source_entry
        join public.knowledge_areas source_area
          on source_area.id = (source_entry.value->>'id')::uuid and source_area.owner_id = auth.uid()
        where source_area.id = existing_card.knowledge_area_id and existing_card.deleted_at is null
          and not exists (select 1 from jsonb_array_elements(source_entry.value->'cards') source_card
            where source_card.value->>'id' = existing_card.id::text)
      )
  ) or exists (
    select 1 from jsonb_array_elements(p_areas) area_entry,
      jsonb_array_elements(area_entry.value->'objectives') objective_entry
    join public.learning_objectives existing_objective
      on existing_objective.id = (objective_entry.value->>'id')::uuid
    where existing_objective.knowledge_area_id <> (area_entry.value->>'id')::uuid
  ) or exists (
    select 1 from jsonb_array_elements(p_tombstones) tombstone_entry
    left join public.knowledge_areas area
      on area.id = (tombstone_entry.value->>'areaId')::uuid and area.owner_id = auth.uid()
    left join public.cards card
      on card.id = (tombstone_entry.value->>'cardId')::uuid
      and card.knowledge_area_id = area.id
    where area.id is null or card.id is null
      or exists (select 1 from jsonb_array_elements(p_areas) target,
        jsonb_array_elements(target.value->'cards') moved_card
        where moved_card.value->>'id' = card.id::text
          and target.value->>'id' <> area.id::text)
  ) then
    return false;
  end if;

  for area_doc in select value from jsonb_array_elements(p_areas) loop
    v_area_id := (area_doc->>'id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_area_id::text, 0));
    v_content_hash := area_doc->>'contentHash';
    version_id := (area_doc->>'versionId')::uuid;

    insert into public.knowledge_areas (id, owner_id, title, description, language, color, tags)
    values (v_area_id, auth.uid(), area_doc->>'title', area_doc->>'description', area_doc->>'language',
      area_doc->>'color', array(select jsonb_array_elements_text(coalesce(area_doc->'tags', '[]'::jsonb))))
    on conflict (id) do update set title = excluded.title, description = excluded.description,
      language = excluded.language, color = excluded.color, tags = excluded.tags, updated_at = now()
      where knowledge_areas.owner_id = auth.uid();

    if not exists (select 1 from public.knowledge_area_versions area_version where area_version.knowledge_area_id = v_area_id and area_version.content_hash = v_content_hash) then
      select coalesce(max(version), 0) + 1 into next_revision
        from public.knowledge_area_versions area_version where area_version.knowledge_area_id = v_area_id;
      insert into public.knowledge_area_versions (id, knowledge_area_id, version, content, content_hash, created_by)
      values (version_id, v_area_id, next_revision, area_doc->'document', v_content_hash, auth.uid());
      update public.knowledge_areas set revision = next_revision, updated_at = now() where id = v_area_id;
    end if;

    for objective_doc in select value from jsonb_array_elements(area_doc->'objectives') loop
      v_objective_id := (objective_doc->>'id')::uuid;
      insert into public.learning_objectives (id, knowledge_area_id, title, description)
      values (v_objective_id, v_area_id, objective_doc->>'title', objective_doc->>'description')
      on conflict (id) do update set title = excluded.title, description = excluded.description, updated_at = now()
        where learning_objectives.knowledge_area_id = v_area_id;
    end loop;

    delete from public.objective_prerequisites where knowledge_area_id = v_area_id;
    insert into public.objective_prerequisites (knowledge_area_id, objective_id, prerequisite_id)
    select v_area_id, (objective.value->>'id')::uuid, prerequisite.value::uuid
      from jsonb_array_elements(area_doc->'objectives') objective,
        jsonb_array_elements_text(objective.value->'prerequisiteIds') prerequisite;

    for card_doc in select value from jsonb_array_elements(area_doc->'cards') loop
      v_card_id := (card_doc->>'id')::uuid;
      v_moved := exists (select 1 from public.cards
        where id = v_card_id and knowledge_area_id <> v_area_id);
      if v_moved then
        delete from public.card_objectives where card_id = v_card_id;
        update public.cards set knowledge_area_id = v_area_id, updated_at = now() where id = v_card_id;
      end if;
      insert into public.cards (id, knowledge_area_id) values (v_card_id, v_area_id)
      on conflict (id) do nothing;
      select card_revision.revision, card_revision.content into next_revision, current_content
        from public.card_revisions card_revision where card_revision.card_id = v_card_id order by card_revision.revision desc limit 1;
      if next_revision is null then
        next_revision := 1;
      elsif current_content = card_doc - 'revisionId' and not v_moved then
        continue;
      else
        next_revision := next_revision + 1;
      end if;
      insert into public.card_revisions (id, card_id, revision, content, provenance, creator_type, created_by)
      values ((card_doc->>'revisionId')::uuid, v_card_id, next_revision, card_doc - 'revisionId',
        'workspace sync', case card_doc->>'origin' when 'ai-generated' then 'ai' when 'imported' then 'import' else 'learner' end,
        auth.uid());
      update public.cards set current_revision = next_revision, updated_at = now() where id = v_card_id;
      delete from public.card_objectives where card_objectives.card_id = v_card_id;
      insert into public.card_objectives (knowledge_area_id, card_id, objective_id)
      select v_area_id, v_card_id, value::uuid from jsonb_array_elements_text(card_doc->'objectiveIds');
    end loop;
  end loop;

  for tombstone_doc in select value from jsonb_array_elements(p_tombstones) loop
    v_area_id := (tombstone_doc->>'areaId')::uuid;
    v_card_id := (tombstone_doc->>'cardId')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_area_id::text, 0));
    if not exists (
      select 1 from public.knowledge_areas area
      join public.cards card on card.knowledge_area_id = area.id
      where area.id = v_area_id and area.owner_id = auth.uid() and card.id = v_card_id
    ) then
      return false;
    end if;
    update public.cards set deleted_at = now(), updated_at = now()
      where id = v_card_id and knowledge_area_id = v_area_id and deleted_at is null;
    if found then
      insert into public.sync_changes (user_id, operation_id, entity_type, entity_id, operation, payload)
      values (
        auth.uid(), gen_random_uuid(), 'card', v_card_id, 'tombstone',
        jsonb_build_object('id', v_card_id, 'areaId', v_area_id, 'deletedAt', now())
      );
    end if;
  end loop;
  return true;
end;
$$;
REVOKE ALL ON FUNCTION public.sync_workspace_content_unchecked(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog', 'public'
AS $$
declare
  invalid_family boolean;
begin
  if auth.uid() is null or jsonb_typeof(p_areas) is distinct from 'array'
    or jsonb_typeof(p_tombstones) is distinct from 'array'
    or jsonb_array_length(p_areas) > 100 or jsonb_array_length(p_tombstones) > 2000 then
    return false;
  end if;
  -- Serialize family discovery and writes for this account, including first-time uploads.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 24));
  if exists (select 1 from jsonb_array_elements(p_areas) entry
    join public.knowledge_areas area on area.id = (entry.value->>'id')::uuid
    where area.owner_id <> auth.uid() or area.deleted_at is not null)
    or (select count(*) from jsonb_array_elements(p_areas)) <>
       (select count(distinct value->>'id') from jsonb_array_elements(p_areas))
    or (select count(*) from jsonb_array_elements(p_areas) area,
          jsonb_array_elements(area.value->'cards')) <>
       (select count(distinct card.value->>'id') from jsonb_array_elements(p_areas) area,
          jsonb_array_elements(area.value->'cards') card) then
    return false;
  end if;
  with incoming as (
    select value->>'id' as id, value->'document' as document from jsonb_array_elements(p_areas)
  ), stored as (
    select area.id::text as id, latest.content as document
    from public.knowledge_areas area
    cross join lateral (select content from public.knowledge_area_versions version
      where version.knowledge_area_id = area.id order by version.version desc limit 1) latest
    where area.owner_id = auth.uid() and area.deleted_at is null
  ), documents as (
    select * from incoming union all select * from stored
  ), links as (
    select documents.id as destination, note.value->'source'->>'areaId' as source
    from documents, jsonb_array_elements(coalesce(documents.document->'noteLibrary'->'notes', '[]')) note
    where note.value->'source'->>'areaId' is not null
  )
  select exists (
    select 1 from links
    where exists (select 1 from documents where id = links.source)
      and ((exists (select 1 from incoming where id = links.source)) <>
           (exists (select 1 from incoming where id = links.destination)))
  ) into invalid_family;
  if invalid_family then return false; end if;
  -- An incoming link must resolve to an active, owned source in this same batch.
  if exists (select 1 from jsonb_array_elements(p_areas) destination,
    jsonb_array_elements(coalesce(destination.value->'document'->'noteLibrary'->'notes', '[]')) note
    where note.value->'source'->>'areaId' is not null
      and not exists (select 1 from jsonb_array_elements(p_areas) source
        where source.value->>'id' = note.value->'source'->>'areaId')) then
    return false;
  end if;
  return public.sync_workspace_content_unchecked(p_areas, p_tombstones);
end;
$$;
REVOKE ALL ON FUNCTION public.sync_workspace_content(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_workspace_content(jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tombstone_knowledge_areas(p_area_tombstones jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
declare
  tombstone_doc jsonb;
  area_id_text text;
  base_hash_text text;
  area_id uuid;
  base_hash text;
  latest_hash text;
begin
  if auth.uid() is null or jsonb_typeof(p_area_tombstones) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_area_tombstones) > 100 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 24));
  -- Deletion cannot strand a surviving linked note in another subject.
  if exists (
    select 1 from public.knowledge_areas area
    cross join lateral (select content from public.knowledge_area_versions version
      where version.knowledge_area_id = area.id order by version.version desc limit 1) latest,
      jsonb_array_elements(coalesce(latest.content->'noteLibrary'->'notes', '[]')) note
    where area.owner_id = auth.uid() and area.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(p_area_tombstones) deleted
        where deleted.value->>'areaId' = area.id::text)
      and exists (select 1 from jsonb_array_elements(p_area_tombstones) deleted
        where deleted.value->>'areaId' = note.value->'source'->>'areaId')
  ) then return false; end if;

  for tombstone_doc in select value from jsonb_array_elements(p_area_tombstones) loop
    area_id_text := tombstone_doc->>'areaId';
    base_hash_text := tombstone_doc->>'baseContentHash';
    if jsonb_typeof(tombstone_doc) <> 'object'
      or area_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or base_hash_text !~* '^[0-9a-f]{64}$' then
      return false;
    end if;
    area_id := area_id_text::uuid;
    base_hash := base_hash_text;
    perform pg_advisory_xact_lock(hashtextextended(area_id::text, 0));
    select version.content_hash into latest_hash
      from public.knowledge_area_versions version
      where version.knowledge_area_id = area_id
      order by version.version desc limit 1;
    if not exists (
      select 1 from public.knowledge_areas area
      where area.id = area_id and area.owner_id = auth.uid() and area.deleted_at is null
    ) or latest_hash is distinct from base_hash then
      return false;
    end if;
  end loop;

  for tombstone_doc in select value from jsonb_array_elements(p_area_tombstones) loop
    area_id := (tombstone_doc->>'areaId')::uuid;
    update public.knowledge_areas set deleted_at = now(), updated_at = now()
      where id = area_id and owner_id = auth.uid() and deleted_at is null;
    if found then
      insert into public.sync_changes (user_id, operation_id, entity_type, entity_id, operation, payload)
      values (
        auth.uid(), gen_random_uuid(), 'area', area_id, 'tombstone',
        jsonb_build_object('id', area_id, 'deletedAt', now())
      );
    end if;
  end loop;
  return true;
end;
$_$;

REVOKE ALL ON FUNCTION public.tombstone_knowledge_areas(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tombstone_knowledge_areas(jsonb) TO authenticated, service_role;
