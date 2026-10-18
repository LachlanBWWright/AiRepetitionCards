

CREATE TABLE public.review_events (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    card_id uuid NOT NULL,
    device_id uuid NOT NULL,
    device_sequence bigint NOT NULL,
    base_review_event_id uuid,
    reviewed_at_device timestamp with time zone NOT NULL,
    effective_reviewed_at timestamp with time zone NOT NULL,
    received_at_server timestamp with time zone DEFAULT now() NOT NULL,
    rating text NOT NULL,
    elapsed_ms integer,
    scheduler_family text NOT NULL,
    scheduler_version text NOT NULL,
    scheduler_parameter_set_id text,
    previous_state_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_events_device_sequence_check CHECK ((device_sequence > 0)),
    CONSTRAINT review_events_elapsed_ms_check CHECK (((elapsed_ms IS NULL) OR (elapsed_ms >= 0))),
    CONSTRAINT review_events_rating_check CHECK ((rating = ANY (ARRAY['again'::text, 'hard'::text, 'good'::text, 'easy'::text]))),
    CONSTRAINT review_events_scheduler_family_check CHECK ((scheduler_family = 'fsrs'::text))
);

CREATE TABLE public.scheduling_state (
    user_id uuid NOT NULL,
    card_id uuid NOT NULL,
    scheduler_family text NOT NULL,
    scheduler_version text NOT NULL,
    last_review_event_id uuid,
    state jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduling_state_scheduler_family_check CHECK ((scheduler_family = 'fsrs'::text))
);

CREATE TABLE public.sync_changes (
    sequence bigint NOT NULL,
    user_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    operation text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_changes_entity_type_check CHECK (((char_length(entity_type) >= 1) AND (char_length(entity_type) <= 40))),
    CONSTRAINT sync_changes_operation_check CHECK ((operation = ANY (ARRAY['upsert'::text, 'tombstone'::text])))
);

ALTER TABLE public.sync_changes ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sync_changes_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.tutor_ai_usage_events (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    operation text NOT NULL,
    model text NOT NULL,
    input_tokens integer,
    output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_ai_usage_events_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT tutor_ai_usage_events_model_check CHECK (((char_length(model) >= 1) AND (char_length(model) <= 120))),
    CONSTRAINT tutor_ai_usage_events_operation_check CHECK ((operation = ANY (ARRAY['question'::text, 'evaluate'::text, 'propose-card'::text, 'targeted-quiz'::text, 'evaluate-quiz-answer'::text]))),
    CONSTRAINT tutor_ai_usage_events_output_tokens_check CHECK ((output_tokens >= 0))
);

CREATE TABLE public.tutor_messages (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sequence bigint NOT NULL,
    role text NOT NULL,
    kind text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tutor_messages_kind_check CHECK ((kind = ANY (ARRAY['question'::text, 'answer'::text, 'feedback'::text, 'proposal'::text]))),
    CONSTRAINT tutor_messages_role_check CHECK ((role = ANY (ARRAY['learner'::text, 'tutor'::text])))
);

ALTER TABLE public.tutor_messages ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tutor_messages_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.tutor_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    area_id text NOT NULL,
    area_title text NOT NULL,
    area_snapshot jsonb NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_observation_id uuid,
    last_proposal_id uuid,
    last_quiz jsonb,
    CONSTRAINT tutor_sessions_area_title_check CHECK (((char_length(area_title) >= 1) AND (char_length(area_title) <= 80))),
    CONSTRAINT tutor_sessions_state_check CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text])))
);

ALTER TABLE ONLY public.ai_observations
    ADD CONSTRAINT ai_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_observations
    ADD CONSTRAINT ai_observations_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE ONLY public.card_objectives
    ADD CONSTRAINT card_objectives_pkey PRIMARY KEY (card_id, objective_id);

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_card_id_id_key UNIQUE (card_id, id);

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_card_id_revision_key UNIQUE (card_id, revision);

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_knowledge_area_id_id_key UNIQUE (knowledge_area_id, id);

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deck_feedback
    ADD CONSTRAINT deck_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deck_feedback
    ADD CONSTRAINT deck_feedback_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE ONLY public.deck_moderation_audit
    ADD CONSTRAINT deck_moderation_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deck_publisher_blocks
    ADD CONSTRAINT deck_publisher_blocks_pkey PRIMARY KEY (user_id, publisher_id);

ALTER TABLE ONLY public.deck_reports
    ADD CONSTRAINT deck_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deck_reports
    ADD CONSTRAINT deck_reports_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE ONLY public.deck_subscriptions
    ADD CONSTRAINT deck_subscriptions_pkey PRIMARY KEY (user_id, area_id);

ALTER TABLE ONLY public.deck_update_reads
    ADD CONSTRAINT deck_update_reads_pkey PRIMARY KEY (user_id, area_id);

ALTER TABLE ONLY public.deck_viewer_grants
    ADD CONSTRAINT deck_viewer_grants_pkey PRIMARY KEY (deck_id, user_id);

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_knowledge_area_id_content_hash_key UNIQUE (knowledge_area_id, content_hash);

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_knowledge_area_id_id_key UNIQUE (knowledge_area_id, id);

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_knowledge_area_id_version_key UNIQUE (knowledge_area_id, version);

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_areas
    ADD CONSTRAINT knowledge_areas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_activity_libraries
    ADD CONSTRAINT learning_activity_libraries_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.learning_objectives
    ADD CONSTRAINT learning_objectives_knowledge_area_id_id_key UNIQUE (knowledge_area_id, id);

ALTER TABLE ONLY public.learning_objectives
    ADD CONSTRAINT learning_objectives_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.objective_prerequisites
    ADD CONSTRAINT objective_prerequisites_pkey PRIMARY KEY (objective_id, prerequisite_id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_source_area_id_version_key UNIQUE (source_area_id, version);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_user_id_card_id_id_key UNIQUE (user_id, card_id, id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_user_id_device_id_device_sequence_key UNIQUE (user_id, device_id, device_sequence);

ALTER TABLE ONLY public.scheduling_state
    ADD CONSTRAINT scheduling_state_pkey PRIMARY KEY (user_id, card_id);

ALTER TABLE ONLY public.shared_decks
    ADD CONSTRAINT shared_decks_pkey PRIMARY KEY (deck_id);

ALTER TABLE ONLY public.sync_changes
    ADD CONSTRAINT sync_changes_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.sync_changes
    ADD CONSTRAINT sync_changes_user_id_operation_id_key UNIQUE (user_id, operation_id);

ALTER TABLE ONLY public.tutor_ai_usage_events
    ADD CONSTRAINT tutor_ai_usage_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_session_id_sequence_key UNIQUE (session_id, sequence);

ALTER TABLE ONLY public.tutor_sessions
    ADD CONSTRAINT tutor_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tutor_sessions
    ADD CONSTRAINT tutor_sessions_user_id_id_key UNIQUE (user_id, id);

CREATE INDEX ai_observations_session_created_idx ON public.ai_observations USING btree (session_id, created_at DESC);

CREATE INDEX card_proposals_session_state_idx ON public.generated_card_proposals USING btree (session_id, state, created_at DESC);

CREATE INDEX cards_area_idx ON public.cards USING btree (knowledge_area_id) WHERE (deleted_at IS NULL);

CREATE INDEX deck_feedback_deck_idx ON public.deck_feedback USING btree (deck_id, created_at DESC);

CREATE INDEX deck_reports_open_idx ON public.deck_reports USING btree (created_at DESC) WHERE (status = 'open'::text);

CREATE UNIQUE INDEX generated_card_proposals_approved_card_unique ON public.generated_card_proposals USING btree (approved_card_id) WHERE (approved_card_id IS NOT NULL);

CREATE INDEX knowledge_areas_owner_updated_idx ON public.knowledge_areas USING btree (owner_id, updated_at DESC);

CREATE INDEX published_knowledge_area_owner_idx ON public.published_knowledge_area_versions USING btree (owner_id, created_at DESC);

CREATE INDEX published_knowledge_area_public_idx ON public.published_knowledge_area_versions USING btree (created_at DESC) WHERE (visibility = 'public'::text);

CREATE INDEX review_events_card_time_idx ON public.review_events USING btree (card_id, effective_reviewed_at);

CREATE INDEX review_events_user_time_idx ON public.review_events USING btree (user_id, effective_reviewed_at DESC);

CREATE INDEX shared_decks_discovery_idx ON public.shared_decks USING btree (deck_id) WHERE ((visibility = 'public'::text) AND (status = 'active'::text));

CREATE INDEX shared_decks_owner_idx ON public.shared_decks USING btree (owner_id, updated_at DESC);

CREATE INDEX sync_changes_user_sequence_idx ON public.sync_changes USING btree (user_id, sequence);

CREATE INDEX tutor_ai_usage_events_owner_day_idx ON public.tutor_ai_usage_events USING btree (user_id, created_at DESC);

CREATE INDEX tutor_messages_session_sequence_idx ON public.tutor_messages USING btree (session_id, sequence);

CREATE INDEX tutor_sessions_user_updated_idx ON public.tutor_sessions USING btree (user_id, updated_at DESC);

CREATE TRIGGER card_revision_links_approved_proposal AFTER INSERT ON public.card_revisions FOR EACH ROW EXECUTE FUNCTION public.link_approved_proposal_revision();

CREATE TRIGGER deck_feedback_updated_at BEFORE UPDATE ON public.deck_feedback FOR EACH ROW EXECUTE FUNCTION public.set_deck_sharing_updated_at();

CREATE TRIGGER deck_feedback_validate BEFORE INSERT OR UPDATE ON public.deck_feedback FOR EACH ROW EXECUTE FUNCTION public.validate_deck_feedback();

CREATE TRIGGER deck_subscriptions_updated_at BEFORE UPDATE ON public.deck_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_deck_sharing_updated_at();

CREATE TRIGGER review_events_enqueue_sync_change AFTER INSERT ON public.review_events FOR EACH ROW EXECUTE FUNCTION public.enqueue_review_sync_change();

CREATE TRIGGER shared_decks_updated_at BEFORE UPDATE ON public.shared_decks FOR EACH ROW EXECUTE FUNCTION public.set_deck_sharing_updated_at();

ALTER TABLE ONLY public.ai_observations
    ADD CONSTRAINT ai_observations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_observations
    ADD CONSTRAINT ai_observations_user_id_session_id_fkey FOREIGN KEY (user_id, session_id) REFERENCES public.tutor_sessions(user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.card_objectives
    ADD CONSTRAINT card_objectives_knowledge_area_id_card_id_fkey FOREIGN KEY (knowledge_area_id, card_id) REFERENCES public.cards(knowledge_area_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.card_objectives
    ADD CONSTRAINT card_objectives_knowledge_area_id_objective_id_fkey FOREIGN KEY (knowledge_area_id, objective_id) REFERENCES public.learning_objectives(knowledge_area_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_card_id_base_revision_id_fkey FOREIGN KEY (card_id, base_revision_id) REFERENCES public.card_revisions(card_id, id);

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.card_revisions
    ADD CONSTRAINT card_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_current_revision_fk FOREIGN KEY (id, current_revision) REFERENCES public.card_revisions(card_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_knowledge_area_id_fkey FOREIGN KEY (knowledge_area_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_feedback
    ADD CONSTRAINT deck_feedback_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.shared_decks(deck_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_feedback
    ADD CONSTRAINT deck_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_feedback
    ADD CONSTRAINT deck_feedback_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.deck_publisher_blocks
    ADD CONSTRAINT deck_publisher_blocks_publisher_id_fkey FOREIGN KEY (publisher_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_publisher_blocks
    ADD CONSTRAINT deck_publisher_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_reports
    ADD CONSTRAINT deck_reports_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.shared_decks(deck_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_reports
    ADD CONSTRAINT deck_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_reports
    ADD CONSTRAINT deck_reports_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.deck_subscriptions
    ADD CONSTRAINT deck_subscriptions_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_subscriptions
    ADD CONSTRAINT deck_subscriptions_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.shared_decks(deck_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_subscriptions
    ADD CONSTRAINT deck_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_subscriptions
    ADD CONSTRAINT deck_subscriptions_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.deck_update_reads
    ADD CONSTRAINT deck_update_reads_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_update_reads
    ADD CONSTRAINT deck_update_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_update_reads
    ADD CONSTRAINT deck_update_reads_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.deck_viewer_grants
    ADD CONSTRAINT deck_viewer_grants_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.shared_decks(deck_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deck_viewer_grants
    ADD CONSTRAINT deck_viewer_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_approved_revision_id_fkey FOREIGN KEY (approved_revision_id) REFERENCES public.card_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.ai_observations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_user_id_observation_id_fkey FOREIGN KEY (user_id, observation_id) REFERENCES public.ai_observations(user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.generated_card_proposals
    ADD CONSTRAINT generated_card_proposals_user_id_session_id_fkey FOREIGN KEY (user_id, session_id) REFERENCES public.tutor_sessions(user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_knowledge_area_id_fkey FOREIGN KEY (knowledge_area_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.knowledge_area_versions
    ADD CONSTRAINT knowledge_area_versions_knowledge_area_id_parent_version_i_fkey FOREIGN KEY (knowledge_area_id, parent_version_id) REFERENCES public.knowledge_area_versions(knowledge_area_id, id);

ALTER TABLE ONLY public.knowledge_areas
    ADD CONSTRAINT knowledge_areas_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_activity_libraries
    ADD CONSTRAINT learning_activity_libraries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_objectives
    ADD CONSTRAINT learning_objectives_knowledge_area_id_fkey FOREIGN KEY (knowledge_area_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.objective_prerequisites
    ADD CONSTRAINT objective_prerequisites_knowledge_area_id_objective_id_fkey FOREIGN KEY (knowledge_area_id, objective_id) REFERENCES public.learning_objectives(knowledge_area_id, id) ON DELETE CASCADE;