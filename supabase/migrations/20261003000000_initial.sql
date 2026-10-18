-- Initial application schema for a fresh Supabase project.
-- Includes learning activities, public/link sharing, updates, and moderation.
-- No historical upgrade or data-backfill migrations are required.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS public;

CREATE FUNCTION public.acknowledge_deck_subscription_update(p_user_id uuid, p_area_id uuid, p_version_id uuid) RETURNS TABLE(deck_id uuid, area_id uuid, known_version_id uuid, latest_version_id uuid, latest_version integer, title text, release_notes text, created_at timestamp with time zone, seen boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare current_update record;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then
  raise insufficient_privilege using message='subscription-owner-required';
 end if;
 select * into current_update
 from public.list_deck_subscription_updates(p_user_id) u
 where u.area_id=p_area_id and u.latest_version_id=p_version_id;
 if not found then raise no_data_found using message='subscription-update-not-found'; end if;
 insert into public.deck_update_reads(user_id,area_id,version_id,read_at)
 values(p_user_id,p_area_id,p_version_id,now())
 on conflict on constraint deck_update_reads_pkey
 do update set version_id=excluded.version_id,read_at=excluded.read_at;
 return query select * from public.list_deck_subscription_updates(p_user_id);
end $$;

CREATE FUNCTION public.can_access_active_deck(p_deck_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select p_user_id is not null and p_user_id=auth.uid() and exists(
  select 1 from public.shared_decks d where d.deck_id=p_deck_id and d.status='active' and d.moderation_status='visible'
   and (d.visibility='public' or public.is_deck_viewer(d.deck_id,p_user_id)))
$$;

CREATE FUNCTION public.can_follow_deck_snapshot(p_user_id uuid, p_area_id uuid, p_deck_id uuid, p_version_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select p_user_id is not null and p_user_id=auth.uid()
  and exists(select 1 from public.knowledge_areas a where a.id=p_area_id and a.owner_id=p_user_id)
  and exists(select 1 from public.shared_decks d join public.published_knowledge_area_versions v on v.source_area_id=d.deck_id
   where d.deck_id=p_deck_id and d.status='active' and d.moderation_status='visible'
    and v.id=p_version_id and v.source_area_id=p_deck_id and v.visibility in ('public','unlisted'))
  and exists(select 1 from public.knowledge_area_versions initial_snapshot
   join public.published_knowledge_area_versions original_source on lower(initial_snapshot.content->>'forkedFromVersionId')=lower(original_source.id::text)
   where initial_snapshot.knowledge_area_id=p_area_id and initial_snapshot.version=1 and initial_snapshot.created_by=p_user_id
    and original_source.source_area_id=p_deck_id)
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.published_knowledge_area_versions (
    id uuid NOT NULL,
    source_area_id uuid,
    owner_id uuid,
    version integer NOT NULL,
    content jsonb NOT NULL,
    content_hash text NOT NULL,
    visibility text NOT NULL,
    attribution text,
    license text,
    forked_from_version_id uuid,
    share_token_hash text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    release_notes text DEFAULT ''::text NOT NULL,
    CONSTRAINT published_knowledge_area_share_token_visibility_check CHECK (((share_token_hash IS NULL) OR (visibility = 'unlisted'::text))),
    CONSTRAINT published_knowledge_area_versions_attribution_check CHECK (((attribution IS NULL) OR (char_length(attribution) <= 500))),
    CONSTRAINT published_knowledge_area_versions_content_check CHECK ((jsonb_typeof(content) = 'object'::text)),
    CONSTRAINT published_knowledge_area_versions_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT published_knowledge_area_versions_license_check CHECK (((license IS NULL) OR (char_length(license) <= 120))),
    CONSTRAINT published_knowledge_area_versions_release_notes_check CHECK ((char_length(release_notes) <= 4000)),
    CONSTRAINT published_knowledge_area_versions_share_token_hash_check CHECK (((share_token_hash IS NULL) OR (share_token_hash ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT published_knowledge_area_versions_version_check CHECK ((version > 0)),
    CONSTRAINT published_knowledge_area_versions_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'unlisted'::text, 'public'::text])))
);

CREATE FUNCTION public.create_deck_publication(p_version_id uuid, p_source_area_id uuid, p_owner_id uuid, p_operation_id uuid, p_content jsonb, p_content_hash text, p_visibility text, p_attribution text, p_license text, p_forked_from_version_id uuid, p_share_token_hash text, p_release_notes text DEFAULT ''::text) RETURNS SETOF public.published_knowledge_area_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare existing public.published_knowledge_area_versions%rowtype; next_version integer; new_row public.published_knowledge_area_versions%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_owner_id is null then raise insufficient_privilege using message='service-role-required'; end if;
 if p_source_area_id is null or p_version_id is null or p_operation_id is null or char_length(coalesce(p_release_notes,''))>4000 then raise invalid_parameter_value using message='invalid-publication'; end if;
 if p_visibility not in ('public','unlisted') then raise check_violation using message='invalid-publication-visibility'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_source_area_id::text,0));
 if not exists(select 1 from public.knowledge_areas a where a.id=p_source_area_id and a.owner_id=p_owner_id and a.deleted_at is null) then raise foreign_key_violation using message='area-not-found'; end if;
 select * into existing from public.published_knowledge_area_versions v where v.id=p_version_id and v.owner_id=p_owner_id;
 if found then
  if existing.source_area_id<>p_source_area_id or existing.content_hash<>p_content_hash or existing.visibility<>p_visibility or existing.release_notes<>coalesce(p_release_notes,'')
   or existing.attribution is distinct from p_attribution or existing.license is distinct from p_license or existing.forked_from_version_id is distinct from p_forked_from_version_id then raise unique_violation using message='publication-operation-conflict'; end if;
  return next existing; return;
 end if;
 select coalesce(max(v.version),0)+1 into next_version from public.published_knowledge_area_versions v where v.source_area_id=p_source_area_id;
 insert into public.published_knowledge_area_versions(id,source_area_id,owner_id,version,content,content_hash,visibility,attribution,license,forked_from_version_id,share_token_hash,created_by,release_notes)
 values(p_version_id,p_source_area_id,p_owner_id,next_version,p_content,p_content_hash,p_visibility,p_attribution,p_license,p_forked_from_version_id,p_share_token_hash,p_owner_id,coalesce(p_release_notes,'')) returning * into new_row;
 insert into public.shared_decks(deck_id,owner_id,title,description,language,tags,author_name,visibility,status,latest_version_id,version,card_count,license,attribution)
 values(p_source_area_id,p_owner_id,coalesce(nullif(left(coalesce(p_content->>'title',p_content->>'name'),300),''),'Untitled deck'),coalesce(left(p_content->>'description',4000),''),coalesce(left(p_content->>'language',40),''),
  case when jsonb_typeof(p_content->'tags')='array' then array(select left(value,80) from jsonb_array_elements_text(p_content->'tags') with ordinality as t(value,n) where char_length(value)<=80 order by n limit 30) else '{}'::text[] end,
  coalesce(left(p_content->>'authorName',120),''),p_visibility,'active',p_version_id,next_version,case when jsonb_typeof(p_content->'cards')='array' then jsonb_array_length(p_content->'cards') else 0 end,p_license,p_attribution)
 on conflict(deck_id) do update set visibility=excluded.visibility,status='active',latest_version_id=excluded.latest_version_id,version=excluded.version,card_count=excluded.card_count,license=excluded.license,attribution=excluded.attribution,updated_at=now();
 return next new_row;
end $$;

CREATE FUNCTION public.create_deck_report(p_id uuid, p_user_id uuid, p_deck_id uuid, p_version_id uuid, p_reason text, p_message text, p_share_token_hash text DEFAULT NULL::text) RETURNS TABLE(id uuid, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
declare
 version_row public.published_knowledge_area_versions%rowtype;
 deck_row public.shared_decks%rowtype;
 saved public.deck_reports%rowtype;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then
  raise insufficient_privilege using message='report-owner-required';
 end if;
 if p_reason not in ('spam','harmful','copyright','broken') or char_length(p_message) not between 1 and 2000 then
  raise check_violation using message='report-invalid';
 end if;
 select * into version_row
 from public.published_knowledge_area_versions v
 where v.id=p_version_id and v.source_area_id=p_deck_id;
 select * into deck_row from public.shared_decks d where d.deck_id=p_deck_id;
 if version_row.id is null or deck_row.deck_id is null or not (
  auth.uid()=version_row.owner_id or
  deck_row.status='active' and deck_row.moderation_status='visible' and version_row.visibility='public' or
  deck_row.status='active' and deck_row.moderation_status='visible' and version_row.visibility='unlisted'
   and version_row.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$'
 ) then
  raise no_data_found using message='publication-not-found';
 end if;
 insert into public.deck_reports(id,user_id,deck_id,version_id,reason,message)
 values(p_id,p_user_id,p_deck_id,p_version_id,p_reason,p_message)
 on conflict on constraint deck_reports_pkey do nothing;
 select * into saved from public.deck_reports r where r.id=p_id and r.user_id=p_user_id;
 if saved.id is null or saved.deck_id<>p_deck_id or saved.version_id<>p_version_id or saved.reason<>p_reason or saved.message<>p_message then
  raise unique_violation using message='report-operation-conflict';
 end if;
 return query select saved.id,saved.status;
end $_$;

CREATE FUNCTION public.enqueue_review_sync_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
begin
  insert into public.sync_changes (
    user_id, operation_id, entity_type, entity_id, operation, payload
  ) values (
    new.user_id, new.id, 'review_event', new.id, 'upsert', to_jsonb(new)
  ) on conflict (user_id, operation_id) do nothing;
  return new;
end;
$$;

CREATE FUNCTION public.erase_account_data(p_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public', 'auth'
    AS $$
begin
  if p_user_id is null or (select auth.role()) <> 'service_role' then
    return false;
  end if;

  update public.review_events
  set base_review_event_id = null
  where user_id = p_user_id and base_review_event_id is not null;
  delete from public.scheduling_state where user_id = p_user_id;
  delete from public.review_events where user_id = p_user_id;
  delete from public.tutor_sessions where user_id = p_user_id;
  delete from public.tutor_ai_usage_events where user_id = p_user_id;
  delete from public.sync_changes where user_id = p_user_id;
  delete from public.knowledge_areas where owner_id = p_user_id;
  delete from public.learning_activity_libraries where user_id = p_user_id;
  delete from public.profiles where user_id = p_user_id;
  return true;
end;
$$;

CREATE FUNCTION public.is_active_deck_viewer(p_deck_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
  select p_user_id is not null and p_user_id=auth.uid() and exists (
    select 1 from public.shared_decks d where d.deck_id=p_deck_id and d.status='active'
      and public.is_deck_viewer(d.deck_id,p_user_id)
  )
$$;

CREATE FUNCTION public.is_active_public_deck(p_deck_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select exists(select 1 from public.shared_decks d where d.deck_id=p_deck_id and d.status='active' and d.moderation_status='visible' and d.visibility='public')
$$;

CREATE FUNCTION public.is_deck_owner(p_deck_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
  select p_user_id is not null and p_user_id=auth.uid() and exists (
    select 1 from public.shared_decks d where d.deck_id=p_deck_id and d.owner_id=p_user_id
  )
$$;

CREATE FUNCTION public.is_deck_viewer(p_deck_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$ select false $$;

CREATE FUNCTION public.link_approved_proposal_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
begin
  update public.generated_card_proposals
  set approved_revision_id = new.id
  where approved_card_id = new.card_id
    and state = 'approved'
    and approved_revision_id is null;
  return new;
end;
$$;

CREATE FUNCTION public.list_deck_subscription_updates(p_user_id uuid) RETURNS TABLE(deck_id uuid, area_id uuid, known_version_id uuid, latest_version_id uuid, latest_version integer, title text, release_notes text, created_at timestamp with time zone, seen boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select d.deck_id,s.area_id,s.version_id,latest_public.id,latest_public.version,
        coalesce(nullif(latest_public.content->>'title',''),nullif(latest_public.content->>'name',''),'Untitled deck'),
        latest_public.release_notes,latest_public.created_at,coalesce(r.version_id=latest_public.id,false)
 from public.deck_subscriptions s
 join public.knowledge_areas a on a.id=s.area_id and a.owner_id=p_user_id
 join public.shared_decks d on d.deck_id=s.deck_id and d.status='active' and d.moderation_status='visible'
 join public.knowledge_areas source_area on source_area.id=d.deck_id and source_area.owner_id=d.owner_id
 join public.published_knowledge_area_versions known on known.id=s.version_id and known.source_area_id=s.deck_id
 join lateral (
  select candidate.id,candidate.version,candidate.release_notes,candidate.created_at,candidate.content
  from public.published_knowledge_area_versions candidate
  where candidate.source_area_id=d.deck_id
    and candidate.visibility='public'
    and candidate.version>known.version
  order by candidate.version desc
  limit 1
 ) latest_public on true
 left join public.deck_update_reads r on r.user_id=p_user_id and r.area_id=s.area_id
 where auth.uid()=p_user_id
   and s.user_id=p_user_id
   and s.following
   and not exists (
    select 1 from public.deck_publisher_blocks b
    where b.user_id=p_user_id and b.publisher_id=d.owner_id
   )
 order by latest_public.created_at desc,s.area_id
$$;

CREATE FUNCTION public.list_deck_versions(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) RETURNS TABLE(id uuid, version integer, created_at timestamp with time zone, visibility text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
 select v.id,v.version,v.created_at,v.visibility from public.published_knowledge_area_versions v join public.shared_decks d on d.deck_id=v.source_area_id
 where d.deck_id=p_deck_id and (
  (auth.uid() is not null and auth.uid()=d.owner_id and p_requester_id=auth.uid()) or
  (d.status='active' and d.moderation_status='visible' and v.visibility='public') or
  (d.status='active' and d.moderation_status='visible' and v.visibility='unlisted' and p_share_token_hash is not null and v.share_token_hash=p_share_token_hash and p_share_token_hash ~ '^[a-f0-9]{64}$')
 ) order by v.version desc
$_$;

CREATE TABLE public.shared_decks (
    deck_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    title text DEFAULT 'Untitled deck'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    language text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    author_name text DEFAULT ''::text NOT NULL,
    visibility text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    latest_version_id uuid NOT NULL,
    version integer NOT NULL,
    card_count integer DEFAULT 0 NOT NULL,
    license text,
    attribution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    moderation_status text DEFAULT 'visible'::text NOT NULL,
    CONSTRAINT shared_decks_attribution_check CHECK (((attribution IS NULL) OR (char_length(attribution) <= 500))),
    CONSTRAINT shared_decks_author_name_check CHECK ((char_length(author_name) <= 120)),
    CONSTRAINT shared_decks_card_count_check CHECK ((card_count >= 0)),
    CONSTRAINT shared_decks_description_check CHECK ((char_length(description) <= 4000)),
    CONSTRAINT shared_decks_language_check CHECK ((char_length(language) <= 40)),
    CONSTRAINT shared_decks_license_check CHECK (((license IS NULL) OR (char_length(license) <= 120))),
    CONSTRAINT shared_decks_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['visible'::text, 'hidden'::text]))),
    CONSTRAINT shared_decks_status_check CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text]))),
    CONSTRAINT shared_decks_tags_check CHECK ((cardinality(tags) <= 30)),
    CONSTRAINT shared_decks_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300))),
    CONSTRAINT shared_decks_version_check CHECK ((version > 0)),
    CONSTRAINT shared_decks_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'unlisted'::text, 'public'::text])))
);

CREATE FUNCTION public.list_owned_shared_decks(p_owner_id uuid, p_limit integer DEFAULT 20, p_cursor uuid DEFAULT NULL::uuid) RETURNS SETOF public.shared_decks
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select d.* from public.shared_decks d where d.owner_id=p_owner_id and auth.uid()=p_owner_id
 and (p_cursor is null or d.deck_id>p_cursor) order by d.deck_id asc limit greatest(1,least(coalesce(p_limit,20),51))
$$;

CREATE FUNCTION public.list_public_shared_decks(p_q text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_tag text DEFAULT NULL::text, p_difficulty text DEFAULT NULL::text, p_activity_type text DEFAULT NULL::text, p_min_minutes integer DEFAULT NULL::integer, p_max_minutes integer DEFAULT NULL::integer, p_limit integer DEFAULT 20, p_cursor uuid DEFAULT NULL::uuid) RETURNS TABLE(deck_id uuid, title text, description text, language text, tags text[], author_name text, visibility text, status text, latest_version_id uuid, version integer, card_count integer, updated_at timestamp with time zone, license text, attribution text, difficulty text, card_types text[], activity_types text[], estimated_minutes integer, preview jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
 select d.deck_id,d.title,d.description,d.language,d.tags,d.author_name,d.visibility,d.status,d.latest_version_id,d.version,d.card_count,d.updated_at,d.license,d.attribution,
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
 from public.shared_decks d join public.published_knowledge_area_versions v on v.id=d.latest_version_id and v.source_area_id=d.deck_id
 where d.visibility='public' and d.status='active' and d.moderation_status='visible'
 and (auth.uid() is null or not exists(select 1 from public.deck_publisher_blocks b where b.user_id=auth.uid() and b.publisher_id=d.owner_id))
 and (p_q is null or d.title ilike '%'||p_q||'%' or d.description ilike '%'||p_q||'%')
 and (p_language is null or lower(d.language)=lower(p_language)) and (p_tag is null or exists(select 1 from unnest(d.tags) t(value) where lower(t.value)=lower(p_tag)))
 and (p_difficulty is null or lower(v.content->>'difficulty')=lower(p_difficulty))
 and (p_activity_type is null or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v.content->'cards')='array' then v.content->'cards' else '[]'::jsonb end) c(value) where lower(c.value->>'kind')=lower(p_activity_type)) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) a(value) where a.value->>'archived' is distinct from 'true' and lower(a.value->>'pluginId')=lower(p_activity_type)))
 and (p_min_minutes is null or least(1000, greatest(1, ceil(coalesce(jsonb_array_length(v.content->'cards'),0) * 0.5 + (select count(*) from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) a(value) where a.value->>'archived' is distinct from 'true') * 3)::integer))>=p_min_minutes)
 and (p_max_minutes is null or least(1000, greatest(1, ceil(coalesce(jsonb_array_length(v.content->'cards'),0) * 0.5 + (select count(*) from jsonb_array_elements(case when jsonb_typeof(v.content->'activities')='array' then v.content->'activities' else '[]'::jsonb end) a(value) where a.value->>'archived' is distinct from 'true') * 3)::integer))<=p_max_minutes)
 and (p_cursor is null or d.deck_id>p_cursor) order by d.deck_id limit greatest(1,least(p_limit,51))
$$;

CREATE FUNCTION public.manage_unlisted_knowledge_area_share_token(p_version_id uuid, p_action text, p_share_token_hash text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
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
$_$;

CREATE FUNCTION public.moderator_list_deck_reports(p_actor_id uuid) RETURNS TABLE(id uuid, deck_id uuid, version_id uuid, title text, reason text, message text, status text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
begin
 if coalesce(auth.role(),'')<>'service_role' or p_actor_id is null then raise insufficient_privilege using message='moderator-service-required'; end if;
 return query select r.id,r.deck_id,r.version_id,d.title,r.reason,r.message,r.status,r.created_at from public.deck_reports r join public.shared_decks d on d.deck_id=r.deck_id order by (r.status='open') desc,r.created_at;
end $$;