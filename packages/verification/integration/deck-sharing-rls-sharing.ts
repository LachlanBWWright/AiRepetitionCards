import { Effect } from "effect";
import type { DeckSharingScenarioContext } from "./deck-sharing-rls-context";
import { deckSharingFixtureMediaId } from "./deck-sharing-rls-fixtures";
import { request, rows, successful, verify } from "./supabase-http";

import type { DeckSharingSubscriptionVersions } from "./deck-sharing-rls-subscriptions";

export function verifyDeckSharingLinkAndModeration(
  context: DeckSharingScenarioContext,
  versions: DeckSharingSubscriptionVersions,
  runId: string,
  sha256: (value: string) => string,
) {
  const {
    config,
    admin,
    anon,
    owner,
    viewer,
    stranger,
    sourceAreaId,
    sourceDocument,
    publicVersionId,
    fixtures,
    rpc,
    expectDenied,
    id,
    publicationIds,
    reportIds,
  } = context;
  const { forkAreaId, blockedUpdateVersionId, latestPublicVersionId, privateVersionId } = versions;
  return Effect.gen(function* () {
    const oldTokenHash = sha256(`old-${runId}`);
    const latestTokenHash = sha256(`latest-${runId}`);
    const oldUnlistedId = id();
    const oldUnlistedArgs = fixtures.publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "unlisted",
      oldUnlistedId,
      oldTokenHash,
    );
    publicationIds.push(oldUnlistedId);
    yield* fixtures.createPublication(oldUnlistedArgs);
    const latestUnlistedId = id();
    const latestUnlistedArgs = fixtures.publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "unlisted",
      latestUnlistedId,
      latestTokenHash,
    );
    publicationIds.push(latestUnlistedId);
    yield* fixtures.createPublication(latestUnlistedArgs);
    const updatesWithUnlistedLatest = yield* rpc(viewer, "list_deck_subscription_updates", {
      p_user_id: viewer.userId,
    });
    const updatesAfterUnlisted = yield* rows(
      updatesWithUnlistedLatest,
      "Updates after a newer unlisted release",
    );
    yield* verify(
      updatesAfterUnlisted.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "area_id" in row &&
          row.area_id === forkAreaId &&
          "latest_version_id" in row &&
          row.latest_version_id === blockedUpdateVersionId,
      ),
      "A later unlisted release suppressed the last public update or leaked into the inbox.",
    );
    const oldExactRead = yield* rpc(anon, "read_deck_version", {
      p_version_id: oldUnlistedId,
      p_requester_id: null,
      p_share_token_hash: oldTokenHash,
    });
    yield* verify(
      (yield* rows(oldExactRead, "Old exact-version capability read")).length === 1,
      "New publication invalidated the prior exact-version unlisted link.",
    );
    const oldVersionHelper = yield* rpc(anon, "read_unlisted_knowledge_area_version", {
      p_version_id: oldUnlistedId,
      p_share_token_hash: oldTokenHash,
    });
    yield* expectDenied(Effect.succeed(oldVersionHelper), "Retired direct unlisted-version helper");
    const oldMediaAuthorization = yield* rpc(anon, "published_media_read_allowed", {
      p_version_id: oldUnlistedId,
      p_owner_id: owner.userId,
      p_media_id: deckSharingFixtureMediaId,
      p_share_token_hash: oldTokenHash,
    });
    yield* verify(
      oldMediaAuthorization.body === true,
      "Old exact-version token could not authorize referenced media.",
    );
    const oldStableLanding = yield* rpc(anon, "read_shared_deck", {
      p_deck_id: sourceAreaId,
      p_requester_id: null,
      p_share_token_hash: oldTokenHash,
    });
    yield* verify(
      (yield* rows(oldStableLanding, "Old token stable landing")).length === 0,
      "An older token resolved the stable deck landing.",
    );
    const latestStableLanding = yield* rpc(anon, "read_shared_deck", {
      p_deck_id: sourceAreaId,
      p_requester_id: null,
      p_share_token_hash: latestTokenHash,
    });
    yield* verify(
      (yield* rows(latestStableLanding, "Latest token stable landing")).length === 1,
      "Latest token did not resolve the stable deck landing.",
    );
    const oldTokenNewRelease = yield* rpc(anon, "read_deck_version", {
      p_version_id: latestUnlistedId,
      p_requester_id: null,
      p_share_token_hash: oldTokenHash,
    });
    yield* verify(
      (yield* rows(oldTokenNewRelease, "New unlisted release with older capability")).length === 0,
      "An older exact-version token revealed a later unlisted release.",
    );

    const reportId = id();
    reportIds.push(reportId);
    const submitReport = () =>
      rpc(viewer, "create_deck_report", {
        p_id: reportId,
        p_user_id: viewer.userId,
        p_deck_id: sourceAreaId,
        p_version_id: publicVersionId,
        p_reason: "broken",
        p_message: "Fixture report for moderation boundary verification.",
        p_share_token_hash: null,
      });
    const submittedReport = yield* submitReport();
    if (submittedReport.status >= 400) {
      const errorCode =
        typeof submittedReport.body === "object" &&
        submittedReport.body !== null &&
        "code" in submittedReport.body &&
        typeof submittedReport.body.code === "string"
          ? submittedReport.body.code
          : "unknown";
      const errorMessage =
        typeof submittedReport.body === "object" &&
        submittedReport.body !== null &&
        "message" in submittedReport.body &&
        typeof submittedReport.body.message === "string"
          ? submittedReport.body.message
          : "unknown";
      yield* verify(false, `Submitted report failed (${errorCode}: ${errorMessage}).`);
    }
    const repeatedReport = yield* submitReport();
    const submittedReportRows = yield* rows(submittedReport, "Submitted idempotent report");
    const repeatedReportRows = yield* rows(repeatedReport, "Repeated idempotent report");
    yield* verify(
      submittedReportRows.length === 1 &&
        repeatedReportRows.length === 1 &&
        typeof repeatedReportRows[0] === "object" &&
        repeatedReportRows[0] !== null &&
        "id" in repeatedReportRows[0] &&
        repeatedReportRows[0].id === reportId,
      "Report retry did not return its canonical ID.",
    );
    const moderatorReports = yield* rpc(admin, "moderator_list_deck_reports", {
      p_actor_id: owner.userId,
    });
    const moderatorReportRows = yield* rows(moderatorReports, "Operator report queue");
    yield* verify(
      moderatorReportRows.some(
        (row) => typeof row === "object" && row !== null && "id" in row && row.id === reportId,
      ),
      "Service-role moderation queue omitted the report.",
    );
    const resolvedReport = yield* rpc(admin, "moderator_set_deck_report_status", {
      p_actor_id: owner.userId,
      p_report_id: reportId,
      p_status: "resolved",
    });
    yield* verify(resolvedReport.body === true, "Operator could not resolve a report.");

    const blocked = yield* rpc(viewer, "set_blocked_deck_publisher", {
      p_user_id: viewer.userId,
      p_deck_id: sourceAreaId,
      p_blocked: true,
      p_share_token_hash: latestTokenHash,
    });
    yield* verify(blocked.body === true, "Learner could not block an accessible publisher.");
    const blockedUpdates = yield* rpc(viewer, "list_deck_subscription_updates", {
      p_user_id: viewer.userId,
    });
    yield* verify(
      !(yield* rows(blockedUpdates, "Updates after publisher block")).some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "deck_id" in row &&
          row.deck_id === sourceAreaId,
      ),
      "Blocking a publisher did not hide its updates.",
    );
    const unblocked = yield* rpc(viewer, "set_blocked_deck_publisher", {
      p_user_id: viewer.userId,
      p_deck_id: sourceAreaId,
      p_blocked: false,
      p_share_token_hash: latestTokenHash,
    });
    yield* verify(unblocked.body === false, "Learner could not unblock a publisher.");

    const hidden = yield* rpc(admin, "moderator_set_deck_status", {
      p_actor_id: owner.userId,
      p_deck_id: sourceAreaId,
      p_status: "hidden",
      p_reason: "Fixture moderation visibility check.",
    });
    yield* verify(hidden.body === true, "Operator could not hide a deck.");
    const hiddenRead = yield* rpc(anon, "read_shared_deck", {
      p_deck_id: sourceAreaId,
      p_requester_id: null,
      p_share_token_hash: null,
    });
    yield* verify(
      (yield* rows(hiddenRead, "Hidden public deck read")).length === 0,
      "Hidden deck remained publicly visible.",
    );
    const visible = yield* rpc(admin, "moderator_set_deck_status", {
      p_actor_id: owner.userId,
      p_deck_id: sourceAreaId,
      p_status: "visible",
      p_reason: "Restore integration fixture visibility.",
    });
    yield* verify(visible.body === true, "Operator could not restore a deck.");
    const protectedAuditRead = yield* request(
      config,
      owner,
      `/rest/v1/deck_moderation_audit?select=id&actor_id=eq.${owner.userId}`,
    );
    yield* expectDenied(
      Effect.succeed(protectedAuditRead),
      "Authenticated moderation-audit table read",
    );
    const protectedAuditUpdate = yield* request(
      config,
      owner,
      `/rest/v1/deck_moderation_audit?actor_id=eq.${owner.userId}`,
      { method: "PATCH", body: { reason: "Tamper with audit history" } },
    );
    yield* expectDenied(
      Effect.succeed(protectedAuditUpdate),
      "Authenticated moderation-audit update",
    );
    const protectedAuditDelete = yield* request(
      config,
      owner,
      `/rest/v1/deck_moderation_audit?actor_id=eq.${owner.userId}`,
      { method: "DELETE" },
    );
    yield* expectDenied(
      Effect.succeed(protectedAuditDelete),
      "Authenticated moderation-audit deletion",
    );

    const withdrawn = yield* request(
      config,
      owner,
      `/rest/v1/shared_decks?deck_id=eq.${sourceAreaId}`,
      {
        method: "PATCH",
        body: { status: "withdrawn" },
        headers: { prefer: "return=minimal" },
      },
    );
    yield* successful(withdrawn, "Owner deck withdrawal");
    for (const [identity, requesterId, versionId, hash] of [
      [anon, null, publicVersionId, null],
      [stranger, stranger.userId, privateVersionId, null],
      [viewer, viewer.userId, privateVersionId, null],
      [anon, null, oldUnlistedId, oldTokenHash],
      [anon, null, latestUnlistedId, latestTokenHash],
    ] as const) {
      const afterWithdrawal = yield* rpc(identity, "read_deck_version", {
        p_version_id: versionId,
        p_requester_id: requesterId,
        p_share_token_hash: hash,
      });
      yield* verify(
        (yield* rows(afterWithdrawal, "Nonowner version read after withdrawal")).length === 0,
        "Withdrawal left a remote version readable.",
      );
    }
    const ownerAfterWithdrawal = yield* rpc(owner, "read_deck_version", {
      p_version_id: latestPublicVersionId,
      p_requester_id: owner.userId,
      p_share_token_hash: null,
    });
    yield* verify(
      (yield* rows(ownerAfterWithdrawal, "Owner private history after withdrawal")).length === 1,
      "Withdrawal removed owner access to immutable history.",
    );
    const ownerDeckAfterWithdrawal = yield* rpc(owner, "read_shared_deck", {
      p_deck_id: sourceAreaId,
      p_requester_id: owner.userId,
      p_share_token_hash: null,
    });
    yield* verify(
      (yield* rows(ownerDeckAfterWithdrawal, "Owner stable deck history after withdrawal"))
        .length === 1,
      "Withdrawal hid owner deck history.",
    );
  });
}
