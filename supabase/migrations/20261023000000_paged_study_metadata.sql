-- Append-only metadata lives in indexed rows; requests and responses remain bounded pages.
create table public.workspace_study_entries (
  sequence bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('adjustments','corrections','undoStates','importedSchedules')),
  entry_id text not null,
  value jsonb not null,
  unique(owner_id,kind,entry_id)
);
create index workspace_study_entries_owner_page on public.workspace_study_entries(owner_id,sequence);
alter table public.workspace_study_entries enable row level security;
create policy workspace_study_entries_owner on public.workspace_study_entries to authenticated
  using(owner_id=auth.uid());
revoke all on public.workspace_study_entries from anon,authenticated;
grant select on public.workspace_study_entries to authenticated;
insert into public.workspace_study_entries(owner_id,kind,entry_id,value)
select s.owner_id, f.kind, e.value->>case when f.kind='undoStates' then 'eventId' when f.kind='importedSchedules' then 'cardId' else 'id' end,e.value
from public.workspace_study s cross join unnest(array['adjustments','corrections','undoStates','importedSchedules']) f(kind)
cross join lateral jsonb_array_elements(coalesce(s.document->f.kind,'[]'::jsonb)) e(value);

create function public.read_workspace_study_page(p_after bigint default 0,p_limit integer default 5000)
returns jsonb language sql security invoker set search_path=public as $$
  with bounded as materialized (
    select sequence,kind,value from public.workspace_study_entries
    where owner_id=auth.uid() and sequence>p_after order by sequence limit least(greatest(p_limit,1),5000)
  ), candidates as (
    select sequence,kind,value,sum(octet_length(value::text)) over(order by sequence) bytes from bounded
  ), page as (
    select sequence,kind,value from candidates where bytes <= 4900000-coalesce((select octet_length((document->'settings')::text) from public.workspace_study where owner_id=auth.uid()),0)
  ), state as (
    select revision,document->'settings' settings from public.workspace_study where owner_id=auth.uid()
  ) select jsonb_build_object(
    'revision',coalesce((select revision from state),0),
    'document',jsonb_build_object('settings',coalesce((select settings from state),'{"requestRetention":0.9}'::jsonb),
      'adjustments',coalesce((select jsonb_agg(value order by sequence) from page where kind='adjustments'),'[]'::jsonb),
      'corrections',coalesce((select jsonb_agg(value order by sequence) from page where kind='corrections'),'[]'::jsonb),
      'undoStates',coalesce((select jsonb_agg(value order by sequence) from page where kind='undoStates'),'[]'::jsonb),
      'importedSchedules',coalesce((select jsonb_agg(value order by sequence) from page where kind='importedSchedules'),'[]'::jsonb)),
    'nextCursor',case when not exists(select 1 from page) and exists(select 1 from candidates) then p_after when exists(select 1 from public.workspace_study_entries where owner_id=auth.uid() and sequence>(select max(sequence) from page)) then (select max(sequence) from page) else null end);
$$;
create function public.sync_workspace_study_batch(p_revision integer,p_document jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_revision integer; field text; entry jsonb; identity text; previous jsonb; total integer:=0;
begin
  if auth.uid() is null or p_revision is null or p_revision<0 or jsonb_typeof(p_document) is distinct from 'object'
    or octet_length(p_document::text)>5000000 or jsonb_typeof(p_document->'settings') is distinct from 'object' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,761));
  select revision into current_revision from public.workspace_study where owner_id=auth.uid() for update;
  if coalesce(current_revision,0)<>p_revision then return null; end if;
  -- Validate every entry before inserting so rejected batches have no partial writes.
  foreach field in array array['adjustments','corrections','undoStates','importedSchedules'] loop
    if jsonb_typeof(coalesce(p_document->field,'[]'::jsonb)) is distinct from 'array' then return null; end if;
    if (select count(distinct value->>case when field='undoStates' then 'eventId' when field='importedSchedules' then 'cardId' else 'id' end) from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb))) <> jsonb_array_length(coalesce(p_document->field,'[]'::jsonb)) then return null; end if;
    total:=total+jsonb_array_length(coalesce(p_document->field,'[]'::jsonb));
    if total>5000 then return null; end if;
    for entry in select value from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb)) loop
      if octet_length(entry::text)+octet_length((p_document->'settings')::text)>4800000 then return null; end if;
      identity:=entry->>case when field='undoStates' then 'eventId' when field='importedSchedules' then 'cardId' else 'id' end;
      if identity is null or length(identity)=0 then return null; end if;
      select value into previous from public.workspace_study_entries where owner_id=auth.uid() and kind=field and entry_id=identity;
      if previous is not null and previous<>entry then return null; end if;
    end loop;
  end loop;
  foreach field in array array['adjustments','corrections','undoStates','importedSchedules'] loop
    for entry in select value from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb)) loop
      identity:=entry->>case when field='undoStates' then 'eventId' when field='importedSchedules' then 'cardId' else 'id' end;
      insert into public.workspace_study_entries(owner_id,kind,entry_id,value) values(auth.uid(),field,identity,entry) on conflict(owner_id,kind,entry_id) do nothing;
    end loop;
  end loop;
  insert into public.workspace_study(owner_id,revision,document)
    values(auth.uid(),p_revision+1,jsonb_build_object('settings',p_document->'settings','adjustments','[]'::jsonb,'corrections','[]'::jsonb,'undoStates','[]'::jsonb,'importedSchedules','[]'::jsonb))
    on conflict(owner_id) do update set revision=excluded.revision,document=excluded.document;
  return jsonb_build_object('revision',p_revision+1);
end;
$$;
-- Legacy reads and revision-checked compatibility writes retain complete history.
create or replace function public.read_workspace_study()
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('revision',coalesce((select revision from public.workspace_study where owner_id=auth.uid()),0),
    'document',jsonb_build_object('settings',coalesce((select document->'settings' from public.workspace_study where owner_id=auth.uid()),'{"requestRetention":0.9}'::jsonb),
      'adjustments',coalesce((select jsonb_agg(value order by sequence) from public.workspace_study_entries where owner_id=auth.uid() and kind='adjustments'),'[]'::jsonb),
      'corrections',coalesce((select jsonb_agg(value order by sequence) from public.workspace_study_entries where owner_id=auth.uid() and kind='corrections'),'[]'::jsonb),
      'undoStates',coalesce((select jsonb_agg(value order by sequence) from public.workspace_study_entries where owner_id=auth.uid() and kind='undoStates'),'[]'::jsonb),
      'importedSchedules',coalesce((select jsonb_agg(value order by sequence) from public.workspace_study_entries where owner_id=auth.uid() and kind='importedSchedules'),'[]'::jsonb)));
$$;
revoke all on function public.read_workspace_study_page(bigint,integer) from public,anon;
revoke all on function public.sync_workspace_study_batch(integer,jsonb) from public,anon;
grant execute on function public.read_workspace_study_page(bigint,integer) to authenticated;
grant execute on function public.sync_workspace_study_batch(integer,jsonb) to authenticated;

-- Compatibility writers must retain every immutable row from the paged store.
create or replace function public.sync_workspace_study(p_revision integer,p_document jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_revision integer; field text; identity_field text;
begin
  if auth.uid() is null or p_revision is null or p_revision<0 or jsonb_typeof(p_document) is distinct from 'object'
    or octet_length(p_document::text)>5000000 or jsonb_typeof(p_document->'settings') is distinct from 'object' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,761));
  select revision into current_revision from public.workspace_study where owner_id=auth.uid() for update;
  if coalesce(current_revision,0)<>p_revision then return null; end if;
  foreach field in array array['adjustments','corrections','undoStates','importedSchedules'] loop
    identity_field:=case when field='undoStates' then 'eventId' when field='importedSchedules' then 'cardId' else 'id' end;
    if jsonb_typeof(coalesce(p_document->field,'[]'::jsonb)) is distinct from 'array' then return null; end if;
    if exists(select value from public.workspace_study_entries where owner_id=auth.uid() and kind=field
      except select value from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb))) then return null; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb)) e(value)
      where coalesce(length(value->>identity_field),0)=0) then return null; end if;
    if (select count(distinct value->>identity_field) from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb))) <> jsonb_array_length(coalesce(p_document->field,'[]'::jsonb)) then return null; end if;
  end loop;
  foreach field in array array['adjustments','corrections','undoStates','importedSchedules'] loop
    identity_field:=case when field='undoStates' then 'eventId' when field='importedSchedules' then 'cardId' else 'id' end;
    insert into public.workspace_study_entries(owner_id,kind,entry_id,value)
      select auth.uid(),field,value->>identity_field,value from jsonb_array_elements(coalesce(p_document->field,'[]'::jsonb)) on conflict(owner_id,kind,entry_id) do nothing;
  end loop;
  insert into public.workspace_study(owner_id,revision,document)
    values(auth.uid(),p_revision+1,jsonb_build_object('settings',p_document->'settings','adjustments','[]'::jsonb,'corrections','[]'::jsonb,'undoStates','[]'::jsonb,'importedSchedules','[]'::jsonb))
    on conflict(owner_id) do update set revision=excluded.revision,document=excluded.document;
  return public.read_workspace_study();
end;
$$;
