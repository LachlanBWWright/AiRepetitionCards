

CREATE FUNCTION public.tombstone_knowledge_areas(p_area_tombstones jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $_$
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
$_$;

CREATE FUNCTION public.validate_deck_feedback() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public'
    AS $$
declare deck_owner uuid; source_id uuid; source_visibility text; deck_status text; latest_version uuid;
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.deck_id<>old.deck_id or new.user_id<>old.user_id or new.version_id<>old.version_id or
     new.card_id is distinct from old.card_id or new.message<>old.message or new.kind<>old.kind or new.created_at<>old.created_at then
   raise insufficient_privilege using message='feedback-fields-immutable';
  end if;
 end if;
 select d.owner_id,d.status into deck_owner,deck_status from public.shared_decks d where d.deck_id=new.deck_id;
 select v.source_area_id,v.visibility,d.latest_version_id into source_id,source_visibility,latest_version from public.published_knowledge_area_versions v join public.shared_decks d on d.deck_id=v.source_area_id where v.id=new.version_id;
 if deck_owner is null or source_id is distinct from new.deck_id then raise check_violation using message='feedback-version-mismatch'; end if;
 if tg_op='INSERT' and deck_status<>'active' then raise insufficient_privilege using message='deck-withdrawn'; end if;
 if new.user_id is distinct from auth.uid() and deck_owner is distinct from auth.uid() then raise insufficient_privilege using message='feedback-owner-mismatch'; end if;
 if deck_owner is distinct from auth.uid() and not public.is_deck_viewer(new.deck_id,auth.uid()) and source_visibility<>'public' then raise insufficient_privilege using message='feedback-version-not-readable'; end if;
 if deck_owner is distinct from auth.uid() and (deck_status<>'active' or (not public.is_deck_viewer(new.deck_id,auth.uid()) and not exists(
  select 1 from public.shared_decks d where d.deck_id=new.deck_id and d.visibility='public'
 ))) then raise insufficient_privilege using message='deck-access-required'; end if;
 return new;
end $$;

CREATE FUNCTION public.write_learning_activities(p_user_id uuid, p_revision bigint, p_library jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = 'pg_catalog', 'public', 'auth'
    AS $_$
declare
  previous public.learning_activity_libraries;
  old_attempt jsonb;
  next_attempt jsonb;
  activity jsonb;
  area_id text;
begin
  if (select auth.role()) is distinct from 'service_role' or p_user_id is null
    or p_revision is null or p_revision < 0
    or jsonb_typeof(p_library) is distinct from 'object'
    or p_library->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_library->'activities') is distinct from 'array'
    or jsonb_typeof(p_library->'attempts') is distinct from 'array'
    or (p_library ? 'drafts' and jsonb_typeof(p_library->'drafts') is distinct from 'array')
    or (p_library ? 'editorDrafts' and jsonb_typeof(p_library->'editorDrafts') is distinct from 'array')
    or octet_length(p_library::text) > 6000000 then
    return jsonb_build_object('error','invalid-library');
  end if;
  if jsonb_array_length(p_library->'activities') > 500
    or jsonb_array_length(p_library->'attempts') > 10000
    or jsonb_array_length(coalesce(p_library->'drafts','[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(p_library->'editorDrafts','[]'::jsonb)) > 500 then
    return jsonb_build_object('error','invalid-library');
  end if;
  -- IDs are mandatory and unique within each record collection.
  if exists (
    select 1 from (
      select key, value from jsonb_each(p_library)
      where key in ('activities','attempts','drafts','editorDrafts')
    ) collections
    cross join lateral jsonb_array_elements(collections.value) entry
    group by collections.key, entry->>'id'
    having entry->>'id' is null or length(entry->>'id') not between 1 and 200 or count(*) > 1
  ) then return jsonb_build_object('error','invalid-library'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,713));
  select * into previous from public.learning_activity_libraries
    where user_id = p_user_id for update;
  if coalesce(previous.revision,0) <> p_revision then
    return jsonb_build_object('error','conflict');
  end if;
  for old_attempt in select value from jsonb_array_elements(coalesce(previous.library->'attempts','[]'::jsonb)) loop
    select value into next_attempt from jsonb_array_elements(p_library->'attempts')
      where value->>'id' = old_attempt->>'id';
    if next_attempt is distinct from old_attempt then
      return jsonb_build_object('error','immutable-attempt');
    end if;
  end loop;

  -- Existing references may point at a deleted deck, retaining its immutable history.
  -- Any new reference must belong to an active deck owned by this account.
  for area_id in
    select distinct entry->>'areaId' from (
      select value entry from jsonb_array_elements(p_library->'activities')
      union all select value->'activity' from jsonb_array_elements(p_library->'attempts')
      union all select value->'activity' from jsonb_array_elements(coalesce(p_library->'drafts','[]'::jsonb))
      union all select value from jsonb_array_elements(coalesce(p_library->'editorDrafts','[]'::jsonb))
    ) entries
  loop
    if area_id is null or length(area_id) not between 1 and 200 then
      return jsonb_build_object('error','invalid-library');
    end if;
    if not exists (
      select 1 from public.knowledge_areas where id::text = area_id
        and owner_id = p_user_id and deleted_at is null
    ) and not exists (
      select 1 from (
        select value entry from jsonb_array_elements(coalesce(previous.library->'activities','[]'::jsonb))
        union all select value->'activity' from jsonb_array_elements(coalesce(previous.library->'attempts','[]'::jsonb))
        union all select value->'activity' from jsonb_array_elements(coalesce(previous.library->'drafts','[]'::jsonb))
        union all select value from jsonb_array_elements(coalesce(previous.library->'editorDrafts','[]'::jsonb))
      ) old_entries where entry->>'areaId' = area_id
    ) then return jsonb_build_object('error','invalid-deck'); end if;
  end loop;
  -- An existing activity cannot regress or change its content without a new revision.
  for activity in select value from jsonb_array_elements(p_library->'activities') loop
    if jsonb_typeof(activity->'revision') is distinct from 'number'
      or (activity->>'revision') !~ '^[1-9][0-9]*$' then
      return jsonb_build_object('error','invalid-library');
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(previous.library->'activities','[]'::jsonb)) saved
      where saved->>'id' = activity->>'id' and (
        (saved->>'revision')::numeric > (activity->>'revision')::numeric
        or ((saved->>'revision')::numeric = (activity->>'revision')::numeric
          and saved is distinct from activity)
      )
    ) then return jsonb_build_object('error','conflict'); end if;
  end loop;
  insert into public.learning_activity_libraries(user_id,revision,library)
    values (p_user_id,p_revision+1,p_library)
    on conflict (user_id) do update set revision = excluded.revision,
      library = excluded.library,updated_at = now();
  return jsonb_build_object('revision',p_revision+1,'library',p_library);
end;
$_$;

CREATE TABLE public.ai_observations (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    objective_id text,
    result text NOT NULL,
    confidence numeric NOT NULL,
    misconception text,
    evidence_summary text NOT NULL,
    suggested_action text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_observations_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT ai_observations_result_check CHECK ((result = ANY (ARRAY['mastered'::text, 'partial'::text, 'incorrect'::text, 'uncertain'::text]))),
    CONSTRAINT ai_observations_suggested_action_check CHECK ((suggested_action = ANY (ARRAY['review-existing-card'::text, 'propose-card'::text, 'targeted-quiz'::text, 'explain'::text, 'none'::text])))
);

CREATE TABLE public.card_objectives (
    knowledge_area_id uuid NOT NULL,
    card_id uuid NOT NULL,
    objective_id uuid NOT NULL
);

CREATE TABLE public.card_revisions (
    id uuid NOT NULL,
    card_id uuid NOT NULL,
    revision integer NOT NULL,
    base_revision_id uuid,
    content jsonb NOT NULL,
    provenance text NOT NULL,
    creator_type text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_revisions_creator_type_check CHECK ((creator_type = ANY (ARRAY['learner'::text, 'import'::text, 'ai'::text]))),
    CONSTRAINT card_revisions_provenance_check CHECK (((char_length(provenance) >= 1) AND (char_length(provenance) <= 120))),
    CONSTRAINT card_revisions_revision_check CHECK ((revision > 0))
);

CREATE TABLE public.cards (
    id uuid NOT NULL,
    knowledge_area_id uuid NOT NULL,
    current_revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cards_current_revision_check CHECK ((current_revision > 0))
);

CREATE TABLE public.deck_feedback (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    deck_id uuid NOT NULL,
    version_id uuid NOT NULL,
    card_id text,
    message text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_feedback_kind_check CHECK ((kind = ANY (ARRAY['issue'::text, 'suggestion'::text]))),
    CONSTRAINT deck_feedback_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 4000))),
    CONSTRAINT deck_feedback_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);

CREATE TABLE public.deck_moderation_audit (
    id bigint NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_moderation_audit_reason_check CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 2000)))
);

ALTER TABLE public.deck_moderation_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.deck_moderation_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.deck_publisher_blocks (
    user_id uuid NOT NULL,
    publisher_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_publisher_blocks_check CHECK ((user_id <> publisher_id))
);

CREATE TABLE public.deck_reports (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    deck_id uuid NOT NULL,
    version_id uuid NOT NULL,
    reason text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_reports_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 2000))),
    CONSTRAINT deck_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harmful'::text, 'copyright'::text, 'broken'::text]))),
    CONSTRAINT deck_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);

CREATE TABLE public.deck_subscriptions (
    user_id uuid NOT NULL,
    deck_id uuid NOT NULL,
    area_id uuid NOT NULL,
    version_id uuid NOT NULL,
    following boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.deck_update_reads (
    user_id uuid NOT NULL,
    area_id uuid NOT NULL,
    version_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.deck_viewer_grants (
    deck_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deck_viewer_grants_role_check CHECK ((role = 'viewer'::text))
);

CREATE TABLE public.generated_card_proposals (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    approved_card_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    approved_revision_id uuid,
    CONSTRAINT generated_card_proposals_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE public.knowledge_area_versions (
    id uuid NOT NULL,
    knowledge_area_id uuid NOT NULL,
    version integer NOT NULL,
    parent_version_id uuid,
    content jsonb NOT NULL,
    content_hash text NOT NULL,
    created_by uuid NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_area_versions_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT knowledge_area_versions_version_check CHECK ((version > 0))
);

CREATE TABLE public.knowledge_areas (
    id uuid NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    language text DEFAULT 'en'::text NOT NULL,
    color text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_areas_color_check CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT knowledge_areas_revision_check CHECK ((revision > 0)),
    CONSTRAINT knowledge_areas_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80))),
    CONSTRAINT knowledge_areas_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);

CREATE TABLE public.learning_activity_libraries (
    user_id uuid NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    library jsonb DEFAULT '{"drafts": [], "version": 1, "attempts": [], "activities": []}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_activity_libraries_library_check CHECK ((octet_length((library)::text) <= 6000000)),
    CONSTRAINT learning_activity_libraries_revision_check CHECK ((revision >= 0))
);

CREATE TABLE public.learning_objectives (
    id uuid NOT NULL,
    knowledge_area_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_objectives_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 160)))
);

CREATE TABLE public.objective_prerequisites (
    knowledge_area_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    prerequisite_id uuid NOT NULL,
    CONSTRAINT objective_prerequisites_check CHECK ((objective_id <> prerequisite_id))
);

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    handle text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_display_name_check CHECK (((display_name IS NULL) OR (char_length(display_name) <= 80))),
    CONSTRAINT profiles_handle_check CHECK (((handle IS NULL) OR (char_length(handle) <= 40)))
);