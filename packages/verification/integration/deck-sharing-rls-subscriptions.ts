import { Effect } from "effect";
import type { DeckSharingScenarioContext } from "./deck-sharing-rls-context";
import { request, rows, successful, verify } from "./supabase-http";

export type DeckSharingSubscriptionVersions = {
  readonly forkAreaId: string;
  readonly blockedUpdateVersionId: string;
  readonly latestPublicVersionId: string;
  readonly privateVersionId: string;
};

export function verifyDeckSharingSubscriptions(context: DeckSharingScenarioContext) {
  const {
    config,
    admin,
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
    areaIds,
    publicationIds,
  } = context;
  return Effect.gen(function* () {
    const forkAreaId = id();
    areaIds.push(forkAreaId);
    const forkDocument = yield* fixtures.areaDocument(forkAreaId, "Personal fork", publicVersionId);
    yield* fixtures.provisionArea(viewer, forkAreaId, forkDocument);

    const latestPublicVersionId = id();
    publicationIds.push(latestPublicVersionId);
    yield* fixtures.createPublication(
      fixtures.publication(
        owner.userId,
        sourceAreaId,
        sourceDocument,
        "public",
        latestPublicVersionId,
        null,
      ),
    );
    const privateVersionId = id();
    const privateArgs = fixtures.publication(
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
    yield* fixtures.createPublication(
      fixtures.publication(
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
    const foreignDocument = yield* fixtures.areaDocument(foreignAreaId, "Unrelated source");
    yield* fixtures.provisionArea(stranger, foreignAreaId, foreignDocument);
    const foreignVersionId = id();
    publicationIds.push(foreignVersionId);
    yield* fixtures.createPublication(
      fixtures.publication(
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

    return { forkAreaId, blockedUpdateVersionId, latestPublicVersionId, privateVersionId };
  });
}
