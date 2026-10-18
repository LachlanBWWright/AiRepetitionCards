import { Effect } from "effect";
import {
  denied,
  request,
  rows,
  successful,
  verify,
  type Configuration,
  type Identity,
  type IntegrationFailure,
  type Reply,
} from "./supabase-http";

type DeckSharingUser = Identity & { readonly userId: string };

export function verifyDeckSharingFeedback(
  config: Configuration,
  owner: Identity,
  viewer: DeckSharingUser,
  sourceAreaId: string,
  publicVersionId: string,
  id: () => string,
  rpc: (
    identity: Identity,
    name: string,
    body: unknown,
  ) => Effect.Effect<Reply, IntegrationFailure>,
) {
  function expectDenied(effect: Effect.Effect<Reply, IntegrationFailure>, label: string) {
    return effect.pipe(
      Effect.flatMap((reply) =>
        verify(
          denied(reply),
          `${label}: unauthorized request was not denied (${String(reply.status)}).`,
        ),
      ),
    );
  }

  return Effect.gen(function* () {
    const legacyViewerCheck = yield* rpc(owner, "is_deck_viewer", {
      p_deck_id: sourceAreaId,
      p_user_id: viewer.userId,
    });
    yield* verify(
      legacyViewerCheck.body === false,
      "Retired named-viewer helper still grants access.",
    );
    const legacyGrantTable = yield* request(
      config,
      owner,
      `/rest/v1/deck_viewer_grants?select=deck_id&deck_id=eq.${sourceAreaId}`,
    );
    yield* expectDenied(Effect.succeed(legacyGrantTable), "Direct retired viewer-grant table read");
    const legacyGrantWrite = yield* request(config, owner, "/rest/v1/deck_viewer_grants", {
      method: "POST",
      body: { deck_id: sourceAreaId, user_id: viewer.userId, role: "viewer" },
      headers: { prefer: "return=minimal" },
    });
    yield* expectDenied(
      Effect.succeed(legacyGrantWrite),
      "Direct retired viewer-grant table write",
    );

    const feedbackId = id();
    const feedbackRequest = {
      id: feedbackId,
      user_id: viewer.userId,
      deck_id: sourceAreaId,
      version_id: publicVersionId,
      card_id: null,
      message: "An idempotent feedback note",
      kind: "suggestion",
      status: "open",
    };
    const insertFeedback = () =>
      request(config, viewer, "/rest/v1/deck_feedback?on_conflict=id", {
        method: "POST",
        body: feedbackRequest,
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      });
    const feedbackInsert = yield* insertFeedback();
    yield* verify(
      feedbackInsert.status >= 200 && feedbackInsert.status < 300,
      `Viewer feedback submission: unexpected HTTP ${String(feedbackInsert.status)} (${JSON.stringify(feedbackInsert.body)}).`,
    );
    const privateFeedbackId = yield* rpc(viewer, "read_my_deck_feedback", { p_id: feedbackId });
    const privateFeedbackRows = yield* rows(privateFeedbackId, "Caller-owned feedback read");
    yield* verify(
      privateFeedbackRows.length === 1,
      "Feedback submitter could not read their own feedback.",
    );
    const ownerFeedback = yield* request(
      config,
      owner,
      `/rest/v1/deck_feedback?select=id,status,version_id&deck_id=eq.${sourceAreaId}`,
    );
    const ownerFeedbackRows = yield* rows(ownerFeedback, "Owner feedback list");
    yield* verify(ownerFeedbackRows.length === 1, "Deck owner could not read submitted feedback.");
    const feedbackIdentityRead = yield* request(
      config,
      owner,
      `/rest/v1/deck_feedback?select=user_id&id=eq.${feedbackId}`,
    );
    yield* verify(
      feedbackIdentityRead.status >= 400,
      "Owner table read exposed feedback submitter identity.",
    );
    const resolveFeedback = yield* request(
      config,
      owner,
      `/rest/v1/deck_feedback?id=eq.${feedbackId}&deck_id=eq.${sourceAreaId}`,
      { method: "PATCH", body: { status: "resolved" }, headers: { prefer: "return=minimal" } },
    );
    yield* successful(resolveFeedback, "Owner feedback resolution");
    const feedbackReplay = yield* insertFeedback();
    yield* successful(feedbackReplay, "Idempotent feedback replay");
    const resolvedFeedback = yield* rpc(viewer, "read_my_deck_feedback", { p_id: feedbackId });
    const resolvedRows = yield* rows(resolvedFeedback, "Feedback replay result");
    const resolved = resolvedRows[0];
    yield* verify(
      resolvedRows.length === 1 &&
        typeof resolved === "object" &&
        resolved !== null &&
        "status" in resolved &&
        resolved.status === "resolved",
      "Feedback replay changed the owner's resolved status.",
    );
  });
}
