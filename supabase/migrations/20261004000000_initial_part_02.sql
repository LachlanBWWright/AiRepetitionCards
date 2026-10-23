-- Forward references in the split schema also need this on pooled connections.
SET LOCAL check_function_bodies = false;
CREATE FUNCTION public.moderator_set_deck_report_status(p_actor_id uuid, p_report_id uuid, p_status text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare report_deck uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_actor_id is null then raise insufficient_privilege using message='moderator-service-required'; end if;
 if p_status not in ('open','resolved') then raise check_violation using message='moderation-invalid'; end if;
 update public.deck_reports set status=p_status where id=p_report_id returning deck_id into report_deck;
 if not found then return false; end if;
 insert into public.deck_moderation_audit(actor_id,action,target_id,reason) values(p_actor_id,'report.'||p_status,p_report_id,'report status updated');
 return true;
end $$;

CREATE FUNCTION public.moderator_set_deck_status(p_actor_id uuid, p_deck_id uuid, p_status text, p_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
begin
 if coalesce(auth.role(),'')<>'service_role' or p_actor_id is null then raise insufficient_privilege using message='moderator-service-required'; end if;
 if p_status not in ('visible','hidden') or char_length(p_reason) not between 1 and 2000 then raise check_violation using message='moderation-invalid'; end if;
 update public.shared_decks set moderation_status=p_status where deck_id=p_deck_id;
 if not found then return false; end if;
 insert into public.deck_moderation_audit(actor_id,action,target_id,reason) values(p_actor_id,'deck.'||p_status,p_deck_id,p_reason);
 return true;
end $$;

CREATE FUNCTION public.published_media_read_allowed(p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select exists(select 1 from public.published_knowledge_area_versions v join public.shared_decks d on d.deck_id=v.source_area_id
  where v.id::text=p_version_id and v.owner_id::text=p_owner_id and
   (auth.uid()=d.owner_id or d.status='active' and d.moderation_status='visible' and
    (v.visibility='public' or v.visibility='unlisted' and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'))
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v.content->'cards')='array' then v.content->'cards' else '[]'::jsonb end) c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'media')='array' then c.value->'media' else '[]'::jsonb end) m where m.value->>'id'=p_media_id))
$_$;

CREATE FUNCTION public.read_deck_version(p_version_id uuid, p_requester_id uuid DEFAULT NULL::uuid, p_share_token_hash text DEFAULT NULL::text) RETURNS TABLE(id uuid, source_area_id uuid, owner_id uuid, version integer, content jsonb, content_hash text, visibility text, attribution text, license text, forked_from_version_id uuid, created_at timestamp with time zone, release_notes text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select v.id,v.source_area_id,v.owner_id,v.version,v.content,v.content_hash,v.visibility,v.attribution,v.license,v.forked_from_version_id,v.created_at,v.release_notes
 from public.published_knowledge_area_versions v join public.shared_decks d on d.deck_id=v.source_area_id
 where v.id=p_version_id and (
  (auth.uid() is not null and auth.uid()=v.owner_id and p_requester_id=auth.uid()) or
  (d.status='active' and d.moderation_status='visible' and v.visibility='public') or
  (d.status='active' and d.moderation_status='visible' and v.visibility='unlisted' and p_share_token_hash is not null and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$')
 )
$_$;

CREATE FUNCTION public.read_deck_version_for_media(p_version_id uuid, p_requester_id uuid DEFAULT NULL::uuid, p_share_token_hash text DEFAULT NULL::text) RETURNS TABLE(id uuid, source_area_id uuid, owner_id uuid, version integer, content jsonb, content_hash text, visibility text, attribution text, license text, forked_from_version_id uuid, created_at timestamp with time zone, release_notes text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$ select * from public.read_deck_version(p_version_id,p_requester_id,p_share_token_hash) $$;

CREATE FUNCTION public.read_learning_activities() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public', 'auth'
    AS $$
  select coalesce((select jsonb_build_object('revision',revision,'library',library) from public.learning_activity_libraries where user_id = (select auth.uid())), '{"revision":0,"library":{"version":1,"activities":[],"attempts":[],"drafts":[]}}'::jsonb);
$$;

CREATE FUNCTION public.read_my_deck_feedback(p_id uuid) RETURNS TABLE(id uuid, deck_id uuid, version_id uuid, card_id text, message text, kind text, status text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select f.id,f.deck_id,f.version_id,f.card_id,f.message,f.kind,f.status,f.created_at
 from public.deck_feedback f where f.id=p_id and f.user_id=auth.uid()
$$;

CREATE FUNCTION public.read_shared_deck(p_deck_id uuid, p_requester_id uuid DEFAULT NULL::uuid, p_share_token_hash text DEFAULT NULL::text) RETURNS TABLE(deck_id uuid, owner_id uuid, title text, description text, language text, tags text[], author_name text, visibility text, status text, latest_version_id uuid, version integer, card_count integer, updated_at timestamp with time zone, license text, attribution text, difficulty text, card_types text[], activity_types text[], estimated_minutes integer, preview jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select d.deck_id,case when auth.uid()=d.owner_id then d.owner_id else null end,d.title,d.description,d.language,d.tags,d.author_name,d.visibility,d.status,d.latest_version_id,d.version,d.card_count,d.updated_at,d.license,d.attribution,
  case when v.content->>'difficulty' in ('beginner','intermediate','advanced') then v.content->>'difficulty' else null end,
  coalesce((select array_agg(distinct c.value->>'kind' order by c.value->>'kind') from jsonb_array_elements(case when jsonb_typeof(v.content->'cards')='array' then v.content->'cards' else '[]'::jsonb end) c(value) where c.value->>'kind' in ('basic','cloze')), '{}'::text[]),
  coalesce((select array_agg(distinct a.value->>'pluginId' order by a.value->>'pluginId') from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) a(value) where a.value->>'archived' is distinct from 'true' and length(a.value->>'pluginId') between 1 and 200), '{}'::text[]),
  least(1000, greatest(1, ceil(coalesce(jsonb_array_length(v.content->'cards'),0) * 0.5 + (select count(*) from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) a(value) where a.value->>'archived' is distinct from 'true') * 3)::integer)),
  coalesce((select jsonb_agg(p.sample order by p.sort_order,p.ordinality) from (
    (select jsonb_build_object('kind', c.value->>'kind', 'prompt', left(case when c.value->>'kind'='basic' then coalesce(c.value->>'front','') else 'Cloze deletion' end, 240), 'answer', case when c.value->>'kind'='basic' then left(coalesce(c.value->>'back',''), 240) else null end) as sample, 1 as sort_order, c.ordinality
     from jsonb_array_elements(case when jsonb_typeof(v.content->'cards')='array' then v.content->'cards' else '[]'::jsonb end) with ordinality c(value, ordinality))
    union all
    (select jsonb_build_object('kind', 'activity', 'prompt', left(coalesce(nullif(a.value->>'title',''),a.value->>'fallback',''),240), 'answer', null) as sample, 2 as sort_order, a.ordinality
     from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) with ordinality a(value, ordinality) where a.value->>'archived' is distinct from 'true')
    order by sort_order,ordinality limit 3
  ) p), '[]'::jsonb)
 from public.shared_decks d join public.published_knowledge_area_versions v on v.id=d.latest_version_id and v.source_area_id=d.deck_id where d.deck_id=p_deck_id and (
  (auth.uid() is not null and auth.uid()=d.owner_id and p_requester_id=auth.uid()) or
  (d.status='active' and d.moderation_status='visible' and d.visibility='public') or
  (d.status='active' and d.moderation_status='visible' and d.visibility='unlisted' and exists(
   select 1 from public.published_knowledge_area_versions v where v.id=d.latest_version_id and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'))
 )
$_$;

CREATE FUNCTION public.read_unlisted_knowledge_area_version(p_version_id uuid, p_share_token_hash text) RETURNS TABLE(id uuid, source_area_id uuid, version integer, content jsonb, content_hash text, attribution text, license text, forked_from_version_id uuid, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select v.id,v.source_area_id,v.version,v.content,v.content_hash,v.attribution,v.license,v.forked_from_version_id,v.created_at
 from public.published_knowledge_area_versions v join public.shared_decks d on d.deck_id=v.source_area_id
 where v.id=p_version_id and v.visibility='unlisted' and d.status='active' and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'
$_$;

CREATE FUNCTION public.read_unlisted_knowledge_area_version_for_media(p_version_id uuid, p_share_token_hash text) RETURNS TABLE(id uuid, owner_id uuid, content jsonb, content_hash text, visibility text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select v.id,v.owner_id,v.content,v.content_hash,v.visibility from public.published_knowledge_area_versions v
 join public.shared_decks d on d.deck_id=v.source_area_id
 where v.id=p_version_id and v.visibility='unlisted' and d.status='active'
 and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'
$_$;

CREATE FUNCTION public.record_tutor_ai_usage(p_id uuid, p_input_tokens integer, p_output_tokens integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
begin
  if auth.uid() is null or p_input_tokens is null or p_output_tokens is null
    or p_input_tokens < 0 or p_output_tokens < 0 then
    return false;
  end if;
  update public.tutor_ai_usage_events
  set input_tokens = p_input_tokens, output_tokens = p_output_tokens
  where id = p_id and user_id = (select auth.uid())
    and input_tokens is null and output_tokens is null;
  return found;
end;
$$;

CREATE FUNCTION public.reserve_tutor_ai_call(p_id uuid, p_operation text, p_model text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare
  caller_id uuid := (select auth.uid());
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  current_count integer;
begin
  if caller_id is null or p_operation not in (
    'question', 'evaluate', 'propose-card', 'targeted-quiz', 'evaluate-quiz-answer'
  ) or char_length(p_model) not between 1 and 120 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || day_start::text, 0));
  select count(*)::integer into current_count
  from public.tutor_ai_usage_events
  where user_id = caller_id and created_at >= day_start;
  if current_count >= 30 then
    return false;
  end if;

  insert into public.tutor_ai_usage_events (id, user_id, operation, model)
  values (p_id, caller_id, p_operation, p_model);
  return true;
end;
$$;

CREATE FUNCTION public.resolve_card_proposal(p_proposal_id uuid, p_state text, p_content jsonb DEFAULT NULL::jsonb, p_card_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare
  resolved_session_id uuid;
begin
  if p_state not in ('approved', 'rejected') then
    return false;
  end if;
  if p_state = 'approved' and p_card_id is null then
    return false;
  end if;
  if p_state = 'approved' and p_content is not null and (
    jsonb_typeof(p_content) <> 'object'
    or coalesce(jsonb_typeof(p_content->'front'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'front')), 0) not between 1 and 1000
    or coalesce(jsonb_typeof(p_content->'back'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'back')), 0) not between 1 and 3000
    or coalesce(jsonb_typeof(p_content->'rationale'), '') <> 'string'
    or coalesce(char_length(btrim(p_content->>'rationale')), 0) not between 1 and 1000
    or not (p_content ? 'objectiveId')
    or (p_content->'objectiveId' <> 'null'::jsonb and coalesce(jsonb_typeof(p_content->'objectiveId'), '') <> 'string')
  ) then
    return false;
  end if;

  update public.generated_card_proposals
  set state = p_state,
      content = case
        when p_state = 'approved' and p_content is not null then p_content
        else content
      end,
      approved_card_id = case when p_state = 'approved' then p_card_id else null end,
      resolved_at = now()
  where id = p_proposal_id
    and user_id = (select auth.uid())
    and state = 'pending'
  returning session_id into resolved_session_id;
  if not found then
    return false;
  end if;
  update public.tutor_sessions
  set last_proposal_id = null, updated_at = now()
  where id = resolved_session_id and user_id = (select auth.uid());
  return true;
end;
$$;

CREATE FUNCTION public.set_blocked_deck_publisher(p_user_id uuid, p_deck_id uuid, p_blocked boolean, p_share_token_hash text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
declare publisher uuid;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise insufficient_privilege using message='block-owner-required'; end if;
 select d.owner_id into publisher from public.shared_decks d where d.deck_id=p_deck_id and (
  (d.status='active' and d.moderation_status='visible' and (d.visibility='public' or d.visibility='unlisted' and exists(
   select 1 from public.published_knowledge_area_versions v where v.source_area_id=d.deck_id and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$')))
  or (not p_blocked and exists(select 1 from public.deck_publisher_blocks b where b.user_id=p_user_id and b.publisher_id=d.owner_id))
 );
 if publisher is null or publisher=p_user_id then raise no_data_found using message='publication-not-found'; end if;
 if p_blocked then insert into public.deck_publisher_blocks(user_id,publisher_id) values(p_user_id,publisher) on conflict do nothing;
 else delete from public.deck_publisher_blocks where user_id=p_user_id and publisher_id=publisher; end if;
 return p_blocked;
end $_$;

CREATE FUNCTION public.set_deck_sharing_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = 'pg_catalog'
    AS $$
begin new.updated_at=now(); return new; end $$;

CREATE FUNCTION public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb) RETURNS boolean
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
