create table public.workspace_study (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  document jsonb not null
);
alter table public.workspace_study enable row level security;
create policy workspace_study_owner on public.workspace_study to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.workspace_study from anon, authenticated;
grant select on public.workspace_study to authenticated;

create function public.sync_workspace_study(p_revision integer, p_document jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare current_row public.workspace_study; field text;
begin
  if auth.uid() is null or p_revision is null or p_revision < 0 or p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or octet_length(p_document::text) > 5000000 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 761));
  select * into current_row from public.workspace_study where owner_id = auth.uid() for update;
  if coalesce(current_row.revision, 0) <> p_revision then return null; end if;
  foreach field in array array['adjustments', 'corrections', 'undoStates'] loop
    if jsonb_typeof(p_document->field) is distinct from 'array' then return null; end if;
    if current_row.document is not null and exists (
      select value from jsonb_array_elements(current_row.document->field)
      except select value from jsonb_array_elements(p_document->field)
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

create function public.read_workspace_study()
returns jsonb language sql security invoker set search_path = public as $$
  select coalesce((select jsonb_build_object('revision', revision, 'document', document)
    from public.workspace_study where owner_id = auth.uid()),
    '{"revision":0,"document":{"settings":{"requestRetention":0.9},"adjustments":[],"corrections":[],"undoStates":[]}}'::jsonb);
$$;
revoke all on function public.read_workspace_study() from public, anon;
grant execute on function public.read_workspace_study() to authenticated;
