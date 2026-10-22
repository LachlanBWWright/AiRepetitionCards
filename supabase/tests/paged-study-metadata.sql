begin;
set local request.jwt.claim.sub='b1111111-1111-4111-8111-111111111111';
insert into auth.users(id) values('b1111111-1111-4111-8111-111111111111'),('b2222222-2222-4222-8222-222222222222');
do $$
declare reply jsonb; page jsonb; cursor bigint; size integer; old_revision integer;
begin
  if public.sync_workspace_study_batch(null,'{"settings":{},"adjustments":[],"corrections":[],"undoStates":[]}'::jsonb) is not null then raise exception 'null revision accepted'; end if;
  reply:=public.sync_workspace_study_batch(0,'{"settings":{"requestRetention":0.9},"adjustments":[],"corrections":[{"id":"a","eventId":"a","recordedAt":"2026-10-22T00:00:00.000Z"},{"id":"b","eventId":"b","recordedAt":"2026-10-22T00:00:00.000Z"}],"undoStates":[]}'::jsonb);
  if reply->>'revision'<>'1' then raise exception 'batch not accepted %',reply; end if;
  page:=public.read_workspace_study_page(0,1);
  if jsonb_array_length(page->'document'->'corrections')<>1 or page->>'nextCursor' is null then raise exception 'first page %',page; end if;
  cursor:=(page->>'nextCursor')::bigint;
  page:=public.read_workspace_study_page(cursor,1);
  if jsonb_array_length(page->'document'->'corrections')<>1 or page->>'nextCursor' is not null then raise exception 'last page %',page; end if;
  if public.sync_workspace_study_batch(0,'{"settings":{}}') is not null then raise exception 'stale revision accepted'; end if;
  if public.sync_workspace_study_batch(1,'{"settings":{},"corrections":[{"id":"a","changed":true}]}') is not null then raise exception 'immutable rewrite accepted'; end if;
  if public.sync_workspace_study_batch(1,'{"settings":{},"corrections":[{"id":"c"},{"id":"c","changed":true}]}') is not null then raise exception 'duplicate entry accepted'; end if;
  select count(*) into size from public.workspace_study_entries where owner_id=auth.uid();
  if size<>2 then raise exception 'rejected batch changed data'; end if;
  if public.sync_workspace_study(1,'{"settings":{},"adjustments":[],"corrections":[],"undoStates":[]}') is not null then raise exception 'legacy writer dropped normalized history'; end if;
  reply:=public.read_workspace_study();
  if jsonb_array_length(reply->'document'->'corrections')<>2 then raise exception 'legacy read lost data'; end if;
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub='b2222222-2222-4222-8222-222222222222';
do $$ begin
  if jsonb_array_length(public.read_workspace_study_page(0,500)->'document'->'corrections')<>0 then raise exception 'cross-owner data leaked'; end if;
  if exists(select 1 from public.workspace_study_entries) then raise exception 'RLS leak'; end if;
end $$;
reset role;

rollback;
