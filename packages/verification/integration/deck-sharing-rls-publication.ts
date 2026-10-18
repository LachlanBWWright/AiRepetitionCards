import { Effect } from "effect";
import { verifyDeckSharingFeedback } from "./deck-sharing-rls-feedback";
import type { DeckSharingScenarioContext } from "./deck-sharing-rls-context";
import { request, rows, verify } from "./supabase-http";

export function verifyDeckSharingPublicPublication(context: DeckSharingScenarioContext) {
  const {
    config,
    admin,
    anon,
    owner,
    viewer,
    sourceAreaId,
    sourceDocument,
    publicVersionId,
    fixtures,
    rpc,
    expectDenied,
    id,
    publicationIds,
  } = context;
  return Effect.gen(function* () {
    const publicArgs = fixtures.publication(
      owner.userId,
      sourceAreaId,
      sourceDocument,
      "public",
      publicVersionId,
      null,
    );
    publicationIds.push(publicVersionId);
    const firstPublication = yield* fixtures.createPublication(publicArgs);
    const replayedPublication = yield* fixtures.createPublication(publicArgs);
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

    yield* verifyDeckSharingFeedback(config, owner, viewer, sourceAreaId, publicVersionId, id, rpc);
  });
}
