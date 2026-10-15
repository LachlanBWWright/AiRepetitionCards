import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { publicationContentHash } from "@recall/application";
import { KnowledgeAreaSchema } from "@recall/domain";
import {
  configuration,
  denied,
  failure,
  request,
  rows,
  successful,
  verify,
  type Configuration,
  type Identity,
  type IntegrationFailure,
  type Reply,
} from "./supabase-http";

const UserSchema = Schema.Struct({ id: Schema.UUID });
const SessionSchema = Schema.Struct({
  access_token: Schema.String.pipe(Schema.minLength(1)),
  user: UserSchema,
});
const id = () => randomUUID();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const mediaId = "a".repeat(64);

function suite(config: Configuration) {
  const admin: Identity = {
    key: config.serviceRoleKey,
    token: config.serviceRoleKey.startsWith("sb_secret_") ? null : config.serviceRoleKey,
  };
  const anon: Identity = {
    key: config.publishableKey,
    token: config.publishableKey.startsWith("sb_publishable_") ? null : config.publishableKey,
  };
  const createdUsers: string[] = [];
  const areaIds: string[] = [];
  const publicationIds: string[] = [];
  const reportIds: string[] = [];
  const runId = id();

  function rpc(identity: Identity, name: string, body: unknown) {
    return request(config, identity, `/rest/v1/rpc/${name}`, { method: "POST", body });
  }
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
  function makeUser(label: string) {
    return Effect.gen(function* () {
      const email = `recall-deck-${runId}-${label}@example.com`;
      const password = `${id()}-aA1!`;
      const created = yield* request(config, admin, "/auth/v1/admin/users", {
        method: "POST",
        body: { email, password, email_confirm: true, user_metadata: { recall_deck_run: runId } },
      });
      yield* successful(created, "Create deck-sharing Auth fixture");
      const user = yield* Schema.decodeUnknown(UserSchema)(created.body).pipe(
        Effect.mapError(() => failure("Deck-sharing Auth identity was invalid.")),
      );
      createdUsers.push(user.id);
      const signedIn = yield* request(config, anon, "/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
      });
      yield* successful(signedIn, "Sign in deck-sharing fixture");
      const session = yield* Schema.decodeUnknown(SessionSchema)(signedIn.body).pipe(
        Effect.mapError(() => failure("Deck-sharing Auth session was invalid.")),
      );
      yield* verify(session.user.id === user.id, "Deck-sharing session changed identity.");
      return { userId: user.id, key: config.publishableKey, token: session.access_token };
    });
  }
  function areaDocument(areaId: string, title: string, lineage?: string) {
    return Schema.decodeUnknown(KnowledgeAreaSchema)({
      schemaVersion: "1.0.0",
      id: areaId,
      title,
      description: null,
      language: "en",
      ...(lineage === undefined ? {} : { forkedFromVersionId: lineage }),
      objectives: [],
      ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
      cards: [
        {
          kind: "basic",
          id: id(),
          front: "Question",
          back: "Answer",
          objectiveIds: [],
          tags: [],
          origin: "authored",
          provenance: { externalId: null, source: "authored", sourceVersion: null },
          media: [{ id: mediaId, mimeType: "image/png", byteLength: 1 }],
        },
      ],
      tags: [],
      licence: "CC-BY-4.0",
    }).pipe(Effect.mapError(() => failure("Deck-sharing area content was invalid.")));
  }
  function provisionArea(
    identity: Identity,
    areaId: string,
    document: Schema.Schema.Type<typeof KnowledgeAreaSchema>,
  ) {
    return Effect.gen(function* () {
      const versionId = id();
      const revisionId = id();
      const envelope = {
        id: areaId,
        title: document.title,
        language: document.language,
        color: "#123456",
        tags: [],
        document,
        contentHash: publicationContentHash(document),
        baseContentHash: null,
        versionId,
        objectives: document.objectives,
        cards: document.cards.map((card) => ({ ...card, revisionId })),
      };
      const synced = yield* rpc(identity, "sync_workspace_content", {
        p_areas: [envelope],
        p_tombstones: [],
      });
      yield* successful(synced, "Provision deck-sharing area through workspace sync");
      yield* verify(synced.body === true, "Workspace sync did not persist the deck-sharing area.");
    });
  }
  function publication(
    ownerId: string,
    areaId: string,
    document: Schema.Schema.Type<typeof KnowledgeAreaSchema>,
    visibility: "public" | "private" | "unlisted",
    versionId: string,
    tokenHash: string | null,
    operationId = id(),
  ) {
    return {
      p_version_id: versionId,
      p_source_area_id: areaId,
      p_owner_id: ownerId,
      p_operation_id: operationId,
      p_content: document,
      p_content_hash: publicationContentHash(document),
      p_visibility: visibility,
      p_attribution: null,
      p_license: "CC-BY-4.0",
      p_forked_from_version_id: null,
      p_share_token_hash: tokenHash,
    };
  }
  function createPublication(args: ReturnType<typeof publication>) {
    return Effect.gen(function* () {
      const result = yield* rpc(admin, "create_deck_publication", args);
      const safeError =
        typeof result.body === "object" && result.body !== null
          ? `${"code" in result.body && typeof result.body.code === "string" ? result.body.code : "error"}: ${"message" in result.body && typeof result.body.message === "string" ? result.body.message : "unknown"}`
          : "unknown response";
      yield* verify(
        result.status >= 200 && result.status < 300,
        `Service publication registration: unexpected HTTP ${String(result.status)} (${safeError}).`,
      );
      const saved = yield* rows(result, "Service publication registration result");
      yield* verify(
        saved.length === 1,
        "Service publication RPC did not return exactly one version.",
      );
      return saved[0];
    });
  }

  const execute = Effect.gen(function* () {
    const owner = yield* makeUser("owner");
    const viewer = yield* makeUser("viewer");
    const stranger = yield* makeUser("stranger");
    const sourceAreaId = id();
    const sourceDocument = yield* areaDocument(sourceAreaId, "Deck sharing source");
    areaIds.push(sourceAreaId);
    yield* provisionArea(owner, sourceAreaId, sourceDocument);

    const publicVersionId = id();
    const publicArgs = publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "public",
      publicVersionId,
      null,
    );
    publicationIds.push(publicVersionId);
    const firstPublication = yield* createPublication(publicArgs);
    const replayedPublication = yield* createPublication(publicArgs);
    yield* verify(
      typeof firstPublication === "object" &&
        firstPublication !== null &&
        typeof replayedPublication === "object" &&
        replayedPublication !== null &&
        "id" in firstPublication &&
        firstPublication.id === publicVersionId &&
        "id" in replayedPublication &&
        replayedPublication.id === publicVersionId,
      "Publication operation replay allocated a different immutable version.",
    );
    const storedVersion = yield* request(
      config,
      admin,
      `/rest/v1/published_knowledge_area_versions?select=id,version&id=eq.${publicVersionId}`,
    );
    const storedRows = yield* rows(storedVersion, "Atomic publication row");
    yield* verify(storedRows.length === 1, "Publication replay duplicated its version row.");

    const ownerDirectRpc = rpc(owner, "create_deck_publication", publicArgs);
    yield* expectDenied(ownerDirectRpc, "Authenticated direct publication RPC");

    const publicCatalog = yield* rpc(anon, "list_public_shared_decks", {
      p_q: "Deck sharing",
      p_language: "en",
      p_tag: null,
      p_limit: 21,
      p_cursor: null,
    });
    const publicRows = yield* rows(publicCatalog, "Safe public deck catalog projection");
    const catalogDeck = publicRows.find(
      (row) =>
        typeof row === "object" && row !== null && "deck_id" in row && row.deck_id === sourceAreaId,
    );
    yield* verify(
      catalogDeck !== undefined,
      "Public deck was missing from safe catalog projection.",
    );
    yield* verify(
      typeof catalogDeck === "object" && catalogDeck !== null && !("owner_id" in catalogDeck),
      "Public catalog projection disclosed owner_id.",
    );
    const publicDetail = yield* rpc(anon, "read_shared_deck", {
      p_deck_id: sourceAreaId,
      p_requester_id: null,
      p_share_token_hash: null,
    });
    const detailRows = yield* rows(publicDetail, "Public stable deck projection");
    yield* verify(
      detailRows.length === 1 &&
        typeof detailRows[0] === "object" &&
        detailRows[0] !== null &&
        "owner_id" in detailRows[0] &&
        detailRows[0].owner_id === null,
      "Public stable deck projection disclosed its owner identity.",
    );
    const ownerTableRead = yield* request(
      config,
      owner,
      `/rest/v1/shared_decks?select=deck_id&deck_id=eq.${sourceAreaId}`,
    );
    yield* verify(
      ownerTableRead.status >= 200 && ownerTableRead.status < 300,
      `Owner row policy could not evaluate through limited column privileges (${String(ownerTableRead.status)}).`,
    );
    const directOwnerId = yield* request(
      config,
      anon,
      `/rest/v1/shared_decks?select=owner_id&deck_id=eq.${sourceAreaId}`,
    );
    yield* verify(directOwnerId.status >= 400, "Anonymous table projection exposed owner_id.");

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
      {
        method: "PATCH",
        body: { status: "resolved" },
        headers: { prefer: "return=minimal" },
      },
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

    const forkAreaId = id();
    areaIds.push(forkAreaId);
    const forkDocument = yield* areaDocument(forkAreaId, "Personal fork", publicVersionId);
    yield* provisionArea(viewer, forkAreaId, forkDocument);

    const latestPublicVersionId = id();
    publicationIds.push(latestPublicVersionId);
    yield* createPublication(
      publication(
        owner.userId,
        sourceAreaId,
        sourceDocument,
        "public",
        latestPublicVersionId,
        null,
      ),
    );
    const privateVersionId = id();
    const privateArgs = publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "private",
      privateVersionId,
      null,
    );
    const rejectedPrivatePublication = yield* rpc(admin, "create_deck_publication", privateArgs);
    yield* verify(
      rejectedPrivatePublication.status >= 400,
      "Private personal content was accepted by the shared publication RPC.",
    );
    const viewerPrivateRead = yield* rpc(viewer, "read_deck_version", {
      p_version_id: privateVersionId,
      p_requester_id: viewer.userId,
      p_share_token_hash: null,
    });
    yield* verify(
      (yield* rows(viewerPrivateRead, "Private version read without link")).length === 0,
      "A signed-in nonowner read a private version without an exact link.",
    );
    const strangerPrivateRead = yield* rpc(stranger, "read_deck_version", {
      p_version_id: privateVersionId,
      p_requester_id: stranger.userId,
      p_share_token_hash: null,
    });
    yield* verify(
      (yield* rows(strangerPrivateRead, "Unshared private version read")).length === 0,
      "Unshared user read a private version.",
    );

    const validSubscription = yield* request(
      config,
      viewer,
      "/rest/v1/deck_subscriptions?on_conflict=user_id,area_id",
      {
        method: "POST",
        body: {
          user_id: viewer.userId,
          deck_id: sourceAreaId,
          area_id: forkAreaId,
          version_id: publicVersionId,
          following: true,
        },
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      },
    );
    yield* successful(validSubscription, "Lineage-matched subscription");
    const subscriptionUpdates = yield* rpc(viewer, "list_deck_subscription_updates", {
      p_user_id: viewer.userId,
    });
    const updateRows = yield* rows(subscriptionUpdates, "Public subscription updates");
    yield* verify(
      updateRows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "area_id" in row &&
          row.area_id === forkAreaId &&
          "latest_version_id" in row &&
          row.latest_version_id === latestPublicVersionId &&
          "seen" in row &&
          row.seen === false,
      ),
      "A newer public release was missing or incorrectly marked read.",
    );
    const acknowledgedUpdate = yield* rpc(viewer, "acknowledge_deck_subscription_update", {
      p_user_id: viewer.userId,
      p_area_id: forkAreaId,
      p_version_id: latestPublicVersionId,
    });
    if (acknowledgedUpdate.status >= 400) {
      const errorCode =
        typeof acknowledgedUpdate.body === "object" &&
        acknowledgedUpdate.body !== null &&
        "code" in acknowledgedUpdate.body &&
        typeof acknowledgedUpdate.body.code === "string"
          ? acknowledgedUpdate.body.code
          : "unknown";
      const errorMessage =
        typeof acknowledgedUpdate.body === "object" &&
        acknowledgedUpdate.body !== null &&
        "message" in acknowledgedUpdate.body &&
        typeof acknowledgedUpdate.body.message === "string"
          ? acknowledgedUpdate.body.message
          : "unknown";
      yield* verify(false, `Acknowledge update failed (${errorCode}: ${errorMessage}).`);
    }
    const acknowledgedRows = yield* rows(acknowledgedUpdate, "Acknowledged subscription update");
    yield* verify(
      acknowledgedRows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "area_id" in row &&
          row.area_id === forkAreaId &&
          "seen" in row &&
          row.seen === true,
      ),
      "Explicit update acknowledgment did not persist its read marker.",
    );
    const laterSubscriptionVersion = yield* request(
      config,
      viewer,
      "/rest/v1/deck_subscriptions?on_conflict=user_id,area_id",
      {
        method: "POST",
        body: {
          user_id: viewer.userId,
          deck_id: sourceAreaId,
          area_id: forkAreaId,
          version_id: latestPublicVersionId,
          following: true,
        },
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      },
    );
    yield* successful(laterSubscriptionVersion, "Follow later version of the same source deck");

    const savedSubscription = yield* request(
      config,
      viewer,
      `/rest/v1/deck_subscriptions?select=version_id&area_id=eq.${forkAreaId}`,
    );
    const savedSubscriptionRows = yield* rows(
      savedSubscription,
      "Updated same-source subscription",
    );
    yield* verify(
      savedSubscriptionRows.length === 1 &&
        typeof savedSubscriptionRows[0] === "object" &&
        savedSubscriptionRows[0] !== null &&
        "version_id" in savedSubscriptionRows[0] &&
        savedSubscriptionRows[0].version_id === latestPublicVersionId,
      "Following a later public same-deck version did not advance the subscription target.",
    );

    const blockedUpdateVersionId = id();
    publicationIds.push(blockedUpdateVersionId);
    yield* createPublication(
      publication(
        owner.userId,
        sourceAreaId,
        sourceDocument,
        "public",
        blockedUpdateVersionId,
        null,
      ),
    );
    const beforeBlockUpdates = yield* rpc(viewer, "list_deck_subscription_updates", {
      p_user_id: viewer.userId,
    });
    yield* verify(
      (yield* rows(beforeBlockUpdates, "Update inbox before publisher block")).some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "deck_id" in row &&
          row.deck_id === sourceAreaId,
      ),
      "Fixture did not have a newer public update before blocking.",
    );
    const publicPublisherBlocked = yield* rpc(viewer, "set_blocked_deck_publisher", {
      p_user_id: viewer.userId,
      p_deck_id: sourceAreaId,
      p_blocked: true,
      p_share_token_hash: null,
    });
    yield* verify(
      publicPublisherBlocked.body === true,
      "Learner could not block a public publisher.",
    );
    const hiddenUpdates = yield* rpc(viewer, "list_deck_subscription_updates", {
      p_user_id: viewer.userId,
    });
    yield* verify(
      !(yield* rows(hiddenUpdates, "Update inbox after publisher block")).some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "deck_id" in row &&
          row.deck_id === sourceAreaId,
      ),
      "Blocking a publisher did not hide its newer public updates.",
    );
    const publicPublisherUnblocked = yield* rpc(viewer, "set_blocked_deck_publisher", {
      p_user_id: viewer.userId,
      p_deck_id: sourceAreaId,
      p_blocked: false,
      p_share_token_hash: null,
    });
    yield* verify(
      publicPublisherUnblocked.body === false,
      "Learner could not unblock a public publisher.",
    );

    const foreignAreaId = id();
    areaIds.push(foreignAreaId);
    const foreignDocument = yield* areaDocument(foreignAreaId, "Unrelated source");
    yield* provisionArea(stranger, foreignAreaId, foreignDocument);
    const foreignVersionId = id();
    publicationIds.push(foreignVersionId);
    yield* createPublication(
      publication(
        stranger.userId,
        foreignAreaId,
        foreignDocument,
        "public",
        foreignVersionId,
        null,
      ),
    );
    const foreignSubscription = yield* request(
      config,
      viewer,
      "/rest/v1/deck_subscriptions?on_conflict=user_id,area_id",
      {
        method: "POST",
        body: {
          user_id: viewer.userId,
          deck_id: sourceAreaId,
          area_id: forkAreaId,
          version_id: foreignVersionId,
          following: true,
        },
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      },
    );
    yield* expectDenied(
      Effect.succeed(foreignSubscription),
      "Subscription to a version from a different source deck",
    );

    const oldTokenHash = sha256(`old-${runId}`);
    const latestTokenHash = sha256(`latest-${runId}`);
    const oldUnlistedId = id();
    const oldUnlistedArgs = publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "unlisted",
      oldUnlistedId,
      oldTokenHash,
    );
    publicationIds.push(oldUnlistedId);
    yield* createPublication(oldUnlistedArgs);
    const latestUnlistedId = id();
    const latestUnlistedArgs = publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "unlisted",
      latestUnlistedId,
      latestTokenHash,
    );
    publicationIds.push(latestUnlistedId);
    yield* createPublication(latestUnlistedArgs);
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
      p_media_id: mediaId,
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

  const cleanup = Effect.gen(function* () {
    const results: Either.Either<unknown, IntegrationFailure>[] = [];
    if (createdUsers.length > 0) {
      results.push(
        yield* Effect.either(
          request(
            config,
            admin,
            `/rest/v1/deck_moderation_audit?actor_id=in.(${createdUsers.join(",")})`,
            { method: "DELETE" },
          ).pipe(
            Effect.flatMap((reply) => successful(reply, "Scoped moderation audit fixture cleanup")),
          ),
        ),
      );
    }
    for (const reportId of reportIds) {
      results.push(
        yield* Effect.either(
          request(config, admin, `/rest/v1/deck_reports?id=eq.${reportId}`, {
            method: "DELETE",
          }).pipe(Effect.flatMap((reply) => successful(reply, "Scoped report fixture cleanup"))),
        ),
      );
    }
    if (areaIds.length > 0) {
      for (const [table, column, label] of [
        ["deck_feedback", "deck_id", "feedback"],
        ["deck_subscriptions", "area_id", "subscriptions"],
        ["deck_update_reads", "area_id", "update read markers"],
      ] as const) {
        results.push(
          yield* Effect.either(
            request(config, admin, `/rest/v1/${table}?${column}=in.(${areaIds.join(",")})`, {
              method: "DELETE",
            }).pipe(Effect.flatMap((reply) => successful(reply, `Scoped ${label} cleanup`))),
          ),
        );
      }
    }
    if (areaIds.length > 0) {
      const deckCleanup = yield* Effect.either(
        request(config, admin, `/rest/v1/shared_decks?deck_id=in.(${areaIds.join(",")})`, {
          method: "DELETE",
        }).pipe(Effect.flatMap((reply) => successful(reply, "Scoped deck registry cleanup"))),
      );
      results.push(deckCleanup);
    }
    for (const publicationId of publicationIds) {
      results.push(
        yield* Effect.either(
          request(
            config,
            admin,
            `/rest/v1/published_knowledge_area_versions?id=eq.${publicationId}`,
            { method: "DELETE" },
          ).pipe(Effect.flatMap((reply) => successful(reply, "Scoped deck version cleanup"))),
        ),
      );
    }
    for (const userId of createdUsers) {
      results.push(
        yield* Effect.either(
          rpc(admin, "erase_account_data", { p_user_id: userId }).pipe(
            Effect.flatMap((reply) => successful(reply, "Deck fixture account cleanup")),
            Effect.flatMap(() =>
              request(config, admin, `/auth/v1/admin/users/${userId}`, { method: "DELETE" }),
            ),
            Effect.flatMap((reply) => successful(reply, "Deck fixture Auth cleanup")),
          ),
        ),
      );
    }
    const cleanupFailures = results
      .filter(Either.isLeft)
      .map((result) => (Either.isLeft(result) ? result.left : null))
      .map((error) =>
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "unknown scoped cleanup failure",
      );
    yield* verify(
      cleanupFailures.length === 0,
      `Deck-sharing fixture cleanup did not fully complete: ${cleanupFailures.join("; ")}`,
    );
  });

  return Effect.gen(function* () {
    const result = yield* Effect.either(execute);
    const cleaned = yield* Effect.either(cleanup);
    if (Either.isLeft(cleaned)) return yield* Effect.fail(cleaned.left);
    if (Either.isLeft(result)) return yield* Effect.fail(result.left);
  });
}

void test("local Supabase public/link sharing, updates, moderation, feedback, and withdrawal RLS", async () => {
  const result = await Effect.runPromise(
    Effect.either(configuration().pipe(Effect.flatMap(suite))),
  );
  assert.ok(Either.isRight(result), Either.isLeft(result) ? result.left.message : undefined);
});
