

ALTER TABLE ONLY public.objective_prerequisites
    ADD CONSTRAINT objective_prerequisites_knowledge_area_id_prerequisite_id_fkey FOREIGN KEY (knowledge_area_id, prerequisite_id) REFERENCES public.learning_objectives(knowledge_area_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_forked_from_version_id_fkey FOREIGN KEY (forked_from_version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.published_knowledge_area_versions
    ADD CONSTRAINT published_knowledge_area_versions_source_area_id_fkey FOREIGN KEY (source_area_id) REFERENCES public.knowledge_areas(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_base_review_event_id_fkey FOREIGN KEY (base_review_event_id) REFERENCES public.review_events(id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_user_id_card_id_base_review_event_id_fkey FOREIGN KEY (user_id, card_id, base_review_event_id) REFERENCES public.review_events(user_id, card_id, id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.scheduling_state
    ADD CONSTRAINT scheduling_state_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.scheduling_state
    ADD CONSTRAINT scheduling_state_user_id_card_id_last_review_event_id_fkey FOREIGN KEY (user_id, card_id, last_review_event_id) REFERENCES public.review_events(user_id, card_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.scheduling_state
    ADD CONSTRAINT scheduling_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shared_decks
    ADD CONSTRAINT shared_decks_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.knowledge_areas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shared_decks
    ADD CONSTRAINT shared_decks_latest_version_id_fkey FOREIGN KEY (latest_version_id) REFERENCES public.published_knowledge_area_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.shared_decks
    ADD CONSTRAINT shared_decks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sync_changes
    ADD CONSTRAINT sync_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tutor_ai_usage_events
    ADD CONSTRAINT tutor_ai_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tutor_messages
    ADD CONSTRAINT tutor_messages_user_id_session_id_fkey FOREIGN KEY (user_id, session_id) REFERENCES public.tutor_sessions(user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tutor_sessions
    ADD CONSTRAINT tutor_sessions_last_observation_owner_fk FOREIGN KEY (user_id, last_observation_id) REFERENCES public.ai_observations(user_id, id);

ALTER TABLE ONLY public.tutor_sessions
    ADD CONSTRAINT tutor_sessions_last_proposal_owner_fk FOREIGN KEY (user_id, last_proposal_id) REFERENCES public.generated_card_proposals(user_id, id);

ALTER TABLE ONLY public.tutor_sessions
    ADD CONSTRAINT tutor_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.ai_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_observations_own ON public.ai_observations TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY area_versions_create_owner ON public.knowledge_area_versions FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = knowledge_area_versions.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY area_versions_read_owner ON public.knowledge_area_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = knowledge_area_versions.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE public.card_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_objectives_owner_all ON public.card_objectives TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = card_objectives.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = card_objectives.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY card_proposals_own ON public.generated_card_proposals TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.card_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_revisions_owner_create ON public.card_revisions FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.cards card
     JOIN public.knowledge_areas area ON ((area.id = card.knowledge_area_id)))
  WHERE ((card.id = card_revisions.card_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY card_revisions_owner_read ON public.card_revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.cards card
     JOIN public.knowledge_areas area ON ((area.id = card.knowledge_area_id)))
  WHERE ((card.id = card_revisions.card_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY cards_owner_all ON public.cards TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = cards.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = cards.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE public.deck_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_feedback_create ON public.deck_feedback FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.is_active_public_deck(deck_id) AND (EXISTS ( SELECT 1
   FROM public.published_knowledge_area_versions v
  WHERE ((v.id = deck_feedback.version_id) AND (v.source_area_id = deck_feedback.deck_id) AND (v.visibility = 'public'::text))))));

CREATE POLICY deck_feedback_owner_update ON public.deck_feedback FOR UPDATE TO authenticated USING (public.is_deck_owner(deck_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_deck_owner(deck_id, ( SELECT auth.uid() AS uid)));

CREATE POLICY deck_feedback_read ON public.deck_feedback FOR SELECT TO authenticated USING ((((user_id = ( SELECT auth.uid() AS uid)) AND public.is_active_public_deck(deck_id)) OR public.is_deck_owner(deck_id, ( SELECT auth.uid() AS uid))));

ALTER TABLE public.deck_moderation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_moderation_audit_actor ON public.deck_moderation_audit FOR SELECT TO authenticated USING ((actor_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.deck_publisher_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_publisher_blocks_owner ON public.deck_publisher_blocks TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.deck_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_reports_owner ON public.deck_reports TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.deck_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_subscriptions_owner_all ON public.deck_subscriptions TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.can_follow_deck_snapshot(( SELECT auth.uid() AS uid), area_id, deck_id, version_id)));

ALTER TABLE public.deck_update_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY deck_update_reads_owner ON public.deck_update_reads TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.deck_viewer_grants ENABLE ROW LEVEL SECURITY;

-- Named-user sharing is disabled; the legacy relation has no client privileges.
CREATE POLICY deck_viewer_grants_disabled ON public.deck_viewer_grants TO authenticated USING (false AND auth.uid() IS NOT NULL);

ALTER TABLE public.generated_card_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_area_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_areas_create_owner ON public.knowledge_areas FOR INSERT TO authenticated WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY knowledge_areas_read_owner ON public.knowledge_areas FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY knowledge_areas_update_owner ON public.knowledge_areas FOR UPDATE TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.learning_activity_libraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY learning_activity_owner_read ON public.learning_activity_libraries FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

ALTER TABLE public.learning_objectives ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.objective_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY objectives_owner_all ON public.learning_objectives TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = learning_objectives.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = learning_objectives.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY prerequisites_owner_all ON public.objective_prerequisites TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = objective_prerequisites.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = objective_prerequisites.knowledge_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_create_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY profiles_read_own ON public.profiles FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY published_areas_create_owner ON public.published_knowledge_area_versions FOR INSERT TO authenticated WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((source_area_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.knowledge_areas area
  WHERE ((area.id = published_knowledge_area_versions.source_area_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))) AND ((forked_from_version_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.published_knowledge_area_versions source_version
  WHERE (source_version.id = source_version.forked_from_version_id))))));

CREATE POLICY published_areas_read_owner ON public.published_knowledge_area_versions FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY published_areas_read_public ON public.published_knowledge_area_versions FOR SELECT TO authenticated, anon USING (((visibility = 'public'::text) AND public.is_active_public_deck(source_area_id)));

ALTER TABLE public.published_knowledge_area_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_events_create_own ON public.review_events FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.cards card
     JOIN public.knowledge_areas area ON ((area.id = card.knowledge_area_id)))
  WHERE ((card.id = review_events.card_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY review_events_read_own ON public.review_events FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.scheduling_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduling_state_own_all ON public.scheduling_state TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.cards card
     JOIN public.knowledge_areas area ON ((area.id = card.knowledge_area_id)))
  WHERE ((card.id = scheduling_state.card_id) AND (area.owner_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.cards card
     JOIN public.knowledge_areas area ON ((area.id = card.knowledge_area_id)))
  WHERE ((card.id = scheduling_state.card_id) AND (area.owner_id = ( SELECT auth.uid() AS uid)))))));

ALTER TABLE public.shared_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_decks_owner_read ON public.shared_decks FOR SELECT TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY shared_decks_owner_update ON public.shared_decks FOR UPDATE TO authenticated USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY shared_decks_public_read ON public.shared_decks FOR SELECT TO authenticated, anon USING (((visibility = 'public'::text) AND (status = 'active'::text)));

ALTER TABLE public.sync_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_changes_read_own ON public.sync_changes FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.tutor_ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_ai_usage_events_own ON public.tutor_ai_usage_events FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_messages_own ON public.tutor_messages TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.tutor_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor_sessions_own ON public.tutor_sessions TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

REVOKE ALL ON TABLE public.published_knowledge_area_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shared_decks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.card_objectives FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.card_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_feedback FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_moderation_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_publisher_blocks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_update_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deck_viewer_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.generated_card_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.knowledge_area_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.knowledge_areas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.learning_activity_libraries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.learning_objectives FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.objective_prerequisites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.review_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.scheduling_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sync_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tutor_ai_usage_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tutor_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tutor_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION public.acknowledge_deck_subscription_update(p_user_id uuid, p_area_id uuid, p_version_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.acknowledge_deck_subscription_update(p_user_id uuid, p_area_id uuid, p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.acknowledge_deck_subscription_update(p_user_id uuid, p_area_id uuid, p_version_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_active_deck(p_deck_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.can_access_active_deck(p_deck_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.can_access_active_deck(p_deck_id uuid, p_user_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_follow_deck_snapshot(p_user_id uuid, p_area_id uuid, p_deck_id uuid, p_version_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.can_follow_deck_snapshot(p_user_id uuid, p_area_id uuid, p_deck_id uuid, p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.can_follow_deck_snapshot(p_user_id uuid, p_area_id uuid, p_deck_id uuid, p_version_id uuid) TO authenticated;

GRANT ALL ON TABLE public.published_knowledge_area_versions TO service_role;

GRANT SELECT(id) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(id) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(source_area_id) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(source_area_id) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(owner_id) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(owner_id) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(version) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(version) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(content) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(content) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(content_hash) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(content_hash) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(visibility) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(visibility) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(attribution) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(attribution) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(license) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(license) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(forked_from_version_id) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(forked_from_version_id) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(created_by) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(created_by) ON TABLE public.published_knowledge_area_versions TO authenticated;

GRANT SELECT(created_at) ON TABLE public.published_knowledge_area_versions TO anon;
GRANT SELECT(created_at) ON TABLE public.published_knowledge_area_versions TO authenticated;

REVOKE ALL ON FUNCTION public.create_deck_publication(p_version_id uuid, p_source_area_id uuid, p_owner_id uuid, p_operation_id uuid, p_content jsonb, p_content_hash text, p_visibility text, p_attribution text, p_license text, p_forked_from_version_id uuid, p_share_token_hash text, p_release_notes text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.create_deck_publication(p_version_id uuid, p_source_area_id uuid, p_owner_id uuid, p_operation_id uuid, p_content jsonb, p_content_hash text, p_visibility text, p_attribution text, p_license text, p_forked_from_version_id uuid, p_share_token_hash text, p_release_notes text) TO service_role;

REVOKE ALL ON FUNCTION public.create_deck_report(p_id uuid, p_user_id uuid, p_deck_id uuid, p_version_id uuid, p_reason text, p_message text, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.create_deck_report(p_id uuid, p_user_id uuid, p_deck_id uuid, p_version_id uuid, p_reason text, p_message text, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.create_deck_report(p_id uuid, p_user_id uuid, p_deck_id uuid, p_version_id uuid, p_reason text, p_message text, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.enqueue_review_sync_change() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.enqueue_review_sync_change() TO service_role;

REVOKE ALL ON FUNCTION public.erase_account_data(p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.erase_account_data(p_user_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_active_deck_viewer(p_deck_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_active_deck_viewer(p_deck_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.is_active_deck_viewer(p_deck_id uuid, p_user_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_public_deck(p_deck_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_active_public_deck(p_deck_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.is_active_public_deck(p_deck_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_active_public_deck(p_deck_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_deck_owner(p_deck_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_deck_owner(p_deck_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.is_deck_owner(p_deck_id uuid, p_user_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_deck_viewer(p_deck_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.is_deck_viewer(p_deck_id uuid, p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.is_deck_viewer(p_deck_id uuid, p_user_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.link_approved_proposal_revision() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.link_approved_proposal_revision() TO service_role;

REVOKE ALL ON FUNCTION public.list_deck_subscription_updates(p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.list_deck_subscription_updates(p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.list_deck_subscription_updates(p_user_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_deck_versions(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.list_deck_versions(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.list_deck_versions(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO anon;
GRANT ALL ON FUNCTION public.list_deck_versions(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO authenticated;

GRANT ALL ON TABLE public.shared_decks TO service_role;

GRANT SELECT(deck_id) ON TABLE public.shared_decks TO anon;
GRANT SELECT(deck_id) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(title) ON TABLE public.shared_decks TO anon;
GRANT SELECT(title),UPDATE(title) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(description) ON TABLE public.shared_decks TO anon;
GRANT SELECT(description),UPDATE(description) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(language) ON TABLE public.shared_decks TO anon;
GRANT SELECT(language),UPDATE(language) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(tags) ON TABLE public.shared_decks TO anon;
GRANT SELECT(tags),UPDATE(tags) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(author_name) ON TABLE public.shared_decks TO anon;
GRANT SELECT(author_name),UPDATE(author_name) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(visibility) ON TABLE public.shared_decks TO anon;
GRANT SELECT(visibility) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(status) ON TABLE public.shared_decks TO anon;
GRANT SELECT(status),UPDATE(status) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(latest_version_id) ON TABLE public.shared_decks TO anon;
GRANT SELECT(latest_version_id) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(version) ON TABLE public.shared_decks TO anon;
GRANT SELECT(version) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(card_count) ON TABLE public.shared_decks TO anon;