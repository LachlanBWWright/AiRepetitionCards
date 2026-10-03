do $$
declare
  constraint_name text;
begin
  select constraint_record.conname
    into constraint_name
    from pg_catalog.pg_constraint constraint_record
   where constraint_record.conrelid = 'public.published_knowledge_area_versions'::regclass
     and constraint_record.contype = 'c'
     and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_record.oid)), 'visibility') > 0
     and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_record.oid)), 'share_token_hash') > 0
   limit 1;

  if constraint_name is not null then
    execute pg_catalog.format(
      'alter table public.published_knowledge_area_versions drop constraint %I',
      constraint_name
    );
  end if;

  alter table public.published_knowledge_area_versions
    add constraint published_knowledge_area_share_token_visibility_check
    check (share_token_hash is null or visibility = 'unlisted');
end;
$$;

comment on constraint published_knowledge_area_share_token_visibility_check
  on public.published_knowledge_area_versions is
  'A missing token revokes an unlisted link without exposing its immutable publication; non-null tokens are valid only for unlisted versions.';
