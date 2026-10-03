create function public.manage_unlisted_knowledge_area_share_token(
  p_version_id uuid,
  p_action text,
  p_share_token_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_action is null or p_action not in ('rotate', 'revoke') then
    return false;
  end if;

  if p_action = 'rotate' then
    if p_share_token_hash is null or p_share_token_hash !~ '^[a-f0-9]{64}$' then
      return false;
    end if;

    update public.published_knowledge_area_versions
       set share_token_hash = p_share_token_hash
     where id = p_version_id
       and owner_id = auth.uid()
       and visibility = 'unlisted';
  else
    if p_share_token_hash is not null then
      return false;
    end if;

    update public.published_knowledge_area_versions
       set share_token_hash = null
     where id = p_version_id
       and owner_id = auth.uid()
       and visibility = 'unlisted';
  end if;

  return found;
end;
$$;

revoke all on function public.manage_unlisted_knowledge_area_share_token(uuid, text, text)
  from public, anon;
grant execute on function public.manage_unlisted_knowledge_area_share_token(uuid, text, text)
  to authenticated;

comment on function public.manage_unlisted_knowledge_area_share_token(uuid, text, text) is
  'Rotates or revokes an unlisted publication token for its owner; accepts only a validated SHA-256 digest and never stores bearer tokens.';
