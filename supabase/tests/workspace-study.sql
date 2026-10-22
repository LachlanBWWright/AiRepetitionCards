-- Run after loading the study-sync migration; wraps all fixtures in a rollback.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000009991'), ('00000000-0000-4000-8000-000000009992');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009991","role":"authenticated"}', true);
do $$
declare doc jsonb := '{"settings":{"requestRetention":0.9},"adjustments":[],"corrections":[],"undoStates":[]}'; result jsonb;
begin
 if public.read_workspace_study()->>'revision' <> '0' then raise exception 'fresh read failed'; end if;
 result := public.sync_workspace_study(0, doc);
 if result->>'revision' <> '1' then raise exception 'initial write failed'; end if;
 if public.sync_workspace_study(0, doc) is not null then raise exception 'stale revision accepted'; end if;
 doc := jsonb_set(doc, '{corrections}', '[{"id":"undo","eventId":"00000000-0000-4000-8000-000000009990","recordedAt":"2026-10-19T00:00:00.000Z"}]');
 result := public.sync_workspace_study(1, doc);
 if result->>'revision' <> '2' then raise exception 'append failed'; end if;
 if public.sync_workspace_study(2, jsonb_set(doc, '{corrections}', '[]')) is not null then raise exception 'append-only removal accepted'; end if;
 doc := jsonb_set(doc, '{importedSchedules}', '[{"areaId":"00000000-0000-4000-8000-000000009993","cardId":"00000000-0000-4000-8000-000000009994","baseline":{"schedule":{},"reviewEventIds":[]}}]');
 result := public.sync_workspace_study(2, doc);
 if result->>'revision' <> '3' then raise exception 'imported schedule append failed'; end if;
 if public.sync_workspace_study(3, doc - 'importedSchedules') is not null then raise exception 'old client dropped imported schedules'; end if;
 if public.sync_workspace_study(3, jsonb_set(doc, '{importedSchedules}', '[]')) is not null then raise exception 'imported schedule removal accepted'; end if;
 if public.sync_workspace_study(3, jsonb_set(doc, '{importedSchedules}', 'null')) is not null then raise exception 'null imported schedules accepted'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009992","role":"authenticated"}', true);
do $$ begin
 if public.read_workspace_study()->>'revision' <> '0' then raise exception 'owner isolation failed'; end if;
 if (select count(*) from public.workspace_study) <> 0 then raise exception 'RLS leak'; end if;
end $$;
reset role;
rollback;
