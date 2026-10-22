-- Entire fixture is rolled back; load migration 20261024000000 first.
begin;
set local request.jwt.claim.sub='c1111111-1111-4111-8111-111111111111';
insert into auth.users(id) values ('c1111111-1111-4111-8111-111111111111');
create function pg_temp.area(id text, hash text, base text, cards jsonb, notes jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('id',id,'title','Atomic note fixture','description','','language','en',
    'color','#123456','tags','[]'::jsonb,'cards',cards,'objectives','[]'::jsonb,
    'document',jsonb_build_object('id',id,'cards',cards,'noteLibrary',jsonb_build_object('notes',notes)),
    'versionId',gen_random_uuid(),'contentHash',hash,'baseContentHash',base)
$$;
do $$
declare
  source text := 'c1111111-1111-4111-8111-111111111112';
  destination text := 'c1111111-1111-4111-8111-111111111113';
  card_id text := 'c1111111-1111-4111-8111-111111111114';
  card jsonb; linked jsonb; old_revision integer;
begin
  card := jsonb_build_object('id',card_id,'revisionId',gen_random_uuid(),'origin','authored','objectiveIds','[]'::jsonb);
  linked := jsonb_build_array(jsonb_build_object('id','note','source',jsonb_build_object('areaId',source)));
  if not public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('a',64),null,jsonb_build_array(card),'[]'),
    pg_temp.area(destination,repeat('b',64),null,'[]',linked)), '[]') then
    raise exception 'complete first family rejected'; end if;
  if public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('c',64),repeat('a',64),jsonb_build_array(card),'[]')), '[]') then
    raise exception 'partial stored family accepted'; end if;
  if public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(destination,repeat('c',64),repeat('b',64),'[]','[]')), '[]') then
    raise exception 'partial unlink accepted'; end if;
  if public.tombstone_knowledge_areas(jsonb_build_array(jsonb_build_object('areaId',source,'baseContentHash',repeat('a',64)))) then
    raise exception 'source deletion stranded linked note'; end if;
  -- A stale member rejects every member, without creating versions on its sibling.
  if public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('c',64),repeat('d',64),jsonb_build_array(card),'[]'),
    pg_temp.area(destination,repeat('c',64),repeat('b',64),'[]',linked)), '[]') then
    raise exception 'stale family accepted'; end if;
  if (select count(*) from public.knowledge_area_versions where knowledge_area_id in (source::uuid,destination::uuid)) <> 2 then
    raise exception 'rejected family partially wrote'; end if;
  -- Moving a card and its old-area tombstone together must reject before any writes.
  if public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('c',64),repeat('a',64),'[]','[]'),
    pg_temp.area(destination,repeat('c',64),repeat('b',64),jsonb_build_array(card),linked)),
    jsonb_build_array(jsonb_build_object('areaId',source,'cardId',card_id))) then
    raise exception 'move plus stale tombstone accepted'; end if;
  if (select knowledge_area_id from public.cards where id=card_id::uuid) <> source::uuid then
    raise exception 'failed move changed placement'; end if;
  select current_revision into old_revision from public.cards where id=card_id::uuid;
  card := card || jsonb_build_object('revisionId',gen_random_uuid());
  if not public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('c',64),repeat('a',64),'[]','[]'),
    pg_temp.area(destination,repeat('c',64),repeat('b',64),jsonb_build_array(card),linked)), '[]') then
    raise exception 'whole-family move rejected'; end if;
  if (select knowledge_area_id from public.cards where id=card_id::uuid) <> destination::uuid
    or (select current_revision from public.cards where id=card_id::uuid) <> old_revision+1 then
    raise exception 'move did not retain card identity and revision history'; end if;
  if not public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(source,repeat('d',64),repeat('c',64),'[]','[]'),
    pg_temp.area(destination,repeat('d',64),repeat('c',64),jsonb_build_array(card),'[]')), '[]') then
    raise exception 'whole-family unlink rejected'; end if;
  if not public.tombstone_knowledge_areas(jsonb_build_array(jsonb_build_object('areaId',source,'baseContentHash',repeat('d',64)))) then
    raise exception 'unlinked source deletion rejected'; end if;
  if public.sync_workspace_content(jsonb_build_array(
    pg_temp.area(destination,repeat('e',64),repeat('d',64),jsonb_build_array(card),linked)), '[]') then
    raise exception 'link to deleted source accepted'; end if;
end $$;
-- No caller may bypass family validation.
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,'public.sync_workspace_content_unchecked(jsonb,jsonb)','execute') then
    raise exception 'unchecked writer executable by authenticated'; end if;
end $$;
reset role;
rollback;
