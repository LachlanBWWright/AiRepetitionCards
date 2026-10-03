drop function if exists public.sync_workspace_content(jsonb);

create function public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
  content_hash text;
  version_id uuid;
  latest_hash text;
  base_hash text;
  incoming_hash text;
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
  ) then
    return false;
  end if;

  for area_doc in select value from jsonb_array_elements(p_areas) loop
    v_area_id := (area_doc->>'id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_area_id::text, 0));
    content_hash := area_doc->>'contentHash';
    version_id := (area_doc->>'versionId')::uuid;

    insert into public.knowledge_areas (id, owner_id, title, description, language, color, tags)
    values (v_area_id, auth.uid(), area_doc->>'title', area_doc->>'description', area_doc->>'language',
      area_doc->>'color', array(select jsonb_array_elements_text(coalesce(area_doc->'tags', '[]'::jsonb))))
    on conflict (id) do update set title = excluded.title, description = excluded.description,
      language = excluded.language, color = excluded.color, tags = excluded.tags, updated_at = now()
      where knowledge_areas.owner_id = auth.uid();

    if not exists (select 1 from public.knowledge_area_versions area_version where area_version.knowledge_area_id = v_area_id and area_version.content_hash = content_hash) then
      select coalesce(max(version), 0) + 1 into next_revision
        from public.knowledge_area_versions area_version where area_version.knowledge_area_id = v_area_id;
      insert into public.knowledge_area_versions (id, knowledge_area_id, version, content, content_hash, created_by)
      values (version_id, v_area_id, next_revision, area_doc->'document', content_hash, auth.uid());
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
    select v_area_id, objective.id::uuid, prerequisite.value::uuid
      from jsonb_array_elements(area_doc->'objectives') objective,
        jsonb_array_elements_text(objective.value->'prerequisiteIds') prerequisite;

    for card_doc in select value from jsonb_array_elements(area_doc->'cards') loop
      v_card_id := (card_doc->>'id')::uuid;
      insert into public.cards (id, knowledge_area_id) values (v_card_id, v_area_id)
      on conflict (id) do nothing;
      select card_revision.revision, card_revision.content into next_revision, current_content
        from public.card_revisions card_revision where card_revision.card_id = v_card_id order by card_revision.revision desc limit 1;
      if next_revision is null then
        next_revision := 1;
      elsif current_content = card_doc - 'revisionId' then
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

revoke all on function public.sync_workspace_content(jsonb, jsonb) from public, anon;
grant execute on function public.sync_workspace_content(jsonb, jsonb) to authenticated;
