
GRANT SELECT(card_count) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(license) ON TABLE public.shared_decks TO anon;
GRANT SELECT(license) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(attribution) ON TABLE public.shared_decks TO anon;
GRANT SELECT(attribution) ON TABLE public.shared_decks TO authenticated;

GRANT SELECT(updated_at) ON TABLE public.shared_decks TO anon;
GRANT SELECT(updated_at) ON TABLE public.shared_decks TO authenticated;

REVOKE ALL ON FUNCTION public.list_owned_shared_decks(p_owner_id uuid, p_limit integer, p_cursor uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.list_owned_shared_decks(p_owner_id uuid, p_limit integer, p_cursor uuid) TO service_role;
GRANT ALL ON FUNCTION public.list_owned_shared_decks(p_owner_id uuid, p_limit integer, p_cursor uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_public_shared_decks(p_q text, p_language text, p_tag text, p_difficulty text, p_activity_type text, p_min_minutes integer, p_max_minutes integer, p_limit integer, p_cursor uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.list_public_shared_decks(p_q text, p_language text, p_tag text, p_difficulty text, p_activity_type text, p_min_minutes integer, p_max_minutes integer, p_limit integer, p_cursor uuid) TO service_role;
GRANT ALL ON FUNCTION public.list_public_shared_decks(p_q text, p_language text, p_tag text, p_difficulty text, p_activity_type text, p_min_minutes integer, p_max_minutes integer, p_limit integer, p_cursor uuid) TO anon;
GRANT ALL ON FUNCTION public.list_public_shared_decks(p_q text, p_language text, p_tag text, p_difficulty text, p_activity_type text, p_min_minutes integer, p_max_minutes integer, p_limit integer, p_cursor uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manage_unlisted_knowledge_area_share_token(p_version_id uuid, p_action text, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.manage_unlisted_knowledge_area_share_token(p_version_id uuid, p_action text, p_share_token_hash text) TO authenticated;
GRANT ALL ON FUNCTION public.manage_unlisted_knowledge_area_share_token(p_version_id uuid, p_action text, p_share_token_hash text) TO service_role;

REVOKE ALL ON FUNCTION public.moderator_list_deck_reports(p_actor_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.moderator_list_deck_reports(p_actor_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.moderator_set_deck_report_status(p_actor_id uuid, p_report_id uuid, p_status text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.moderator_set_deck_report_status(p_actor_id uuid, p_report_id uuid, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.moderator_set_deck_status(p_actor_id uuid, p_deck_id uuid, p_status text, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.moderator_set_deck_status(p_actor_id uuid, p_deck_id uuid, p_status text, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.published_media_read_allowed(p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.published_media_read_allowed(p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.published_media_read_allowed(p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text) TO anon;
GRANT ALL ON FUNCTION public.published_media_read_allowed(p_version_id text, p_owner_id text, p_media_id text, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.read_deck_version(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_deck_version(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.read_deck_version(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO anon;
GRANT ALL ON FUNCTION public.read_deck_version(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.read_deck_version_for_media(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_deck_version_for_media(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.read_deck_version_for_media(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO anon;
GRANT ALL ON FUNCTION public.read_deck_version_for_media(p_version_id uuid, p_requester_id uuid, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.read_learning_activities() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_learning_activities() TO authenticated;
GRANT ALL ON FUNCTION public.read_learning_activities() TO service_role;

REVOKE ALL ON FUNCTION public.read_my_deck_feedback(p_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_my_deck_feedback(p_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.read_my_deck_feedback(p_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.read_shared_deck(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_shared_deck(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.read_shared_deck(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO anon;
GRANT ALL ON FUNCTION public.read_shared_deck(p_deck_id uuid, p_requester_id uuid, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.read_unlisted_knowledge_area_version(p_version_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_unlisted_knowledge_area_version(p_version_id uuid, p_share_token_hash text) TO service_role;

REVOKE ALL ON FUNCTION public.read_unlisted_knowledge_area_version_for_media(p_version_id uuid, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.read_unlisted_knowledge_area_version_for_media(p_version_id uuid, p_share_token_hash text) TO service_role;

REVOKE ALL ON FUNCTION public.record_tutor_ai_usage(p_id uuid, p_input_tokens integer, p_output_tokens integer) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.record_tutor_ai_usage(p_id uuid, p_input_tokens integer, p_output_tokens integer) TO authenticated;
GRANT ALL ON FUNCTION public.record_tutor_ai_usage(p_id uuid, p_input_tokens integer, p_output_tokens integer) TO service_role;

REVOKE ALL ON FUNCTION public.reserve_tutor_ai_call(p_id uuid, p_operation text, p_model text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.reserve_tutor_ai_call(p_id uuid, p_operation text, p_model text) TO authenticated;
GRANT ALL ON FUNCTION public.reserve_tutor_ai_call(p_id uuid, p_operation text, p_model text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_card_proposal(p_proposal_id uuid, p_state text, p_content jsonb, p_card_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.resolve_card_proposal(p_proposal_id uuid, p_state text, p_content jsonb, p_card_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.resolve_card_proposal(p_proposal_id uuid, p_state text, p_content jsonb, p_card_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_blocked_deck_publisher(p_user_id uuid, p_deck_id uuid, p_blocked boolean, p_share_token_hash text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.set_blocked_deck_publisher(p_user_id uuid, p_deck_id uuid, p_blocked boolean, p_share_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.set_blocked_deck_publisher(p_user_id uuid, p_deck_id uuid, p_blocked boolean, p_share_token_hash text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_deck_sharing_updated_at() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.set_deck_sharing_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.sync_workspace_content(p_areas jsonb, p_tombstones jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.tombstone_knowledge_areas(p_area_tombstones jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.tombstone_knowledge_areas(p_area_tombstones jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.tombstone_knowledge_areas(p_area_tombstones jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.validate_deck_feedback() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.validate_deck_feedback() TO service_role;

REVOKE ALL ON FUNCTION public.write_learning_activities(p_user_id uuid, p_revision bigint, p_library jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.write_learning_activities(p_user_id uuid, p_revision bigint, p_library jsonb) TO service_role;

GRANT ALL ON TABLE public.ai_observations TO service_role;
GRANT SELECT,INSERT ON TABLE public.ai_observations TO authenticated;

GRANT ALL ON TABLE public.card_objectives TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.card_objectives TO authenticated;

GRANT ALL ON TABLE public.card_revisions TO service_role;
GRANT SELECT,INSERT ON TABLE public.card_revisions TO authenticated;

GRANT ALL ON TABLE public.cards TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.cards TO authenticated;

GRANT ALL ON TABLE public.deck_feedback TO service_role;
GRANT INSERT ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(id) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(deck_id) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(version_id) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(card_id) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(message) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(kind) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(status),UPDATE(status) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(created_at) ON TABLE public.deck_feedback TO authenticated;

GRANT SELECT(updated_at) ON TABLE public.deck_feedback TO authenticated;

GRANT ALL ON TABLE public.deck_moderation_audit TO service_role;

GRANT ALL ON SEQUENCE public.deck_moderation_audit_id_seq TO anon;
GRANT ALL ON SEQUENCE public.deck_moderation_audit_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.deck_moderation_audit_id_seq TO service_role;

GRANT ALL ON TABLE public.deck_publisher_blocks TO service_role;

GRANT ALL ON TABLE public.deck_reports TO service_role;

GRANT ALL ON TABLE public.deck_subscriptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.deck_subscriptions TO authenticated;

GRANT ALL ON TABLE public.deck_update_reads TO service_role;

GRANT ALL ON TABLE public.deck_viewer_grants TO service_role;

GRANT ALL ON TABLE public.generated_card_proposals TO service_role;
GRANT SELECT,INSERT ON TABLE public.generated_card_proposals TO authenticated;

GRANT ALL ON TABLE public.knowledge_area_versions TO service_role;
GRANT SELECT,INSERT ON TABLE public.knowledge_area_versions TO authenticated;

GRANT ALL ON TABLE public.knowledge_areas TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.knowledge_areas TO authenticated;

GRANT ALL ON TABLE public.learning_activity_libraries TO service_role;
GRANT SELECT ON TABLE public.learning_activity_libraries TO authenticated;

GRANT ALL ON TABLE public.learning_objectives TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.learning_objectives TO authenticated;

GRANT ALL ON TABLE public.objective_prerequisites TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.objective_prerequisites TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.profiles TO authenticated;

GRANT ALL ON TABLE public.review_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.review_events TO authenticated;

GRANT ALL ON TABLE public.scheduling_state TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scheduling_state TO authenticated;

GRANT ALL ON TABLE public.sync_changes TO service_role;
GRANT SELECT ON TABLE public.sync_changes TO authenticated;

GRANT ALL ON SEQUENCE public.sync_changes_sequence_seq TO anon;
GRANT ALL ON SEQUENCE public.sync_changes_sequence_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sync_changes_sequence_seq TO service_role;

GRANT ALL ON TABLE public.tutor_ai_usage_events TO service_role;
GRANT SELECT ON TABLE public.tutor_ai_usage_events TO authenticated;

GRANT ALL ON TABLE public.tutor_messages TO service_role;
GRANT SELECT,INSERT ON TABLE public.tutor_messages TO authenticated;

GRANT ALL ON SEQUENCE public.tutor_messages_sequence_seq TO anon;
GRANT ALL ON SEQUENCE public.tutor_messages_sequence_seq TO authenticated;
GRANT ALL ON SEQUENCE public.tutor_messages_sequence_seq TO service_role;

GRANT ALL ON TABLE public.tutor_sessions TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tutor_sessions TO authenticated;

-- Private published media bucket and reference-scoped storage access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'published-media',
  'published-media',
  false,
  20000000,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY published_media_delete_owner ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'published-media'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY published_media_read_owner_or_shared ON storage.objects AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((bucket_id = 'published-media'::text) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR public.published_media_read_allowed(COALESCE(( SELECT ((current_setting('request.headers'::text, true))::jsonb ->> 'x-recall-publication-version-id'::text)), ''::text), split_part(name, '/'::text, 1), split_part(name, '/'::text, 2), COALESCE(( SELECT ((current_setting('request.headers'::text, true))::jsonb ->> 'x-recall-share-token-hash'::text)), ''::text)))));
CREATE POLICY published_media_upload_owner ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'published-media'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (split_part(name, '/'::text, 1) = (( SELECT auth.uid() AS uid))::text) AND (name ~ '^[0-9a-f-]{36}/[a-f0-9]{64}$'::text)));

NOTIFY pgrst, 'reload schema';
