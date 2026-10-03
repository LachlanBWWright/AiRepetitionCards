create function public.tombstone_knowledge_areas(p_area_tombstones jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  tombstone_doc jsonb;
  area_id_text text;
  base_hash_text text;
  area_id uuid;
  base_hash text;
  latest_hash text;
begin
  if auth.uid() is null or jsonb_typeof(p_area_tombstones) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_area_tombstones) > 100 then
    return false;
  end if;

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
$$;

revoke all on function public.tombstone_knowledge_areas(jsonb) from public, anon;
grant execute on function public.tombstone_knowledge_areas(jsonb) to authenticated;

drop policy review_events_create_own on public.review_events;
create policy review_events_create_own on public.review_events
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.cards card
      join public.knowledge_areas area on area.id = card.knowledge_area_id
      where card.id = card_id and area.owner_id = (select auth.uid())
    )
  );
