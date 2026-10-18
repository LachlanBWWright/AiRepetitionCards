import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createDeckSharingApi,
  createPublishingApi,
  type DeckSharingHttpRequest,
  type DeckSharingHttpResponse,
} from "@recall/application";

const deckId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherDeckId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const versionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const timestamp = "2026-10-15T00:00:00.000Z";
const summary = {
  id: deckId,
  title: "Shared deck",
  description: "",
  language: "en",
  tags: [],
  authorName: "Author",
  visibility: "public",
  status: "active",
  latestVersionId: versionId,
  version: 1,
  cardCount: 0,
  updatedAt: timestamp,
  license: null,
  attribution: null,
};

function apiFor(response: DeckSharingHttpResponse, seen: DeckSharingHttpRequest[] = []) {
  return createDeckSharingApi((request) => {
    seen.push(request);
    return Effect.succeed(response);
  });
}

void test("deck sharing validates untrusted response JSON and returns typed failures", async () => {
  for (const body of [null, "not json", { schemaVersion: 1, decks: "wrong", nextCursor: null }]) {
    const result = await Effect.runPromise(Effect.either(apiFor({ status: 200, body }).listMine()));
    assert.ok(Either.isLeft(result));
    assert.deepEqual(result.left, { _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  }
});

void test("deck sharing classifies HTTP and transport failures without leaking vendor details", async () => {
  const http = await Effect.runPromise(
    Effect.either(apiFor({ status: 403, body: { error: "private database detail" } }).listMine()),
  );
  assert.ok(Either.isLeft(http));
  assert.deepEqual(http.left, { _tag: "DeckSharingApiFailure", reason: "http", status: 403 });

  const transport = createDeckSharingApi(() =>
    Effect.fail({ _tag: "DeckSharingTransportFailure" }),
  );
  const unavailable = await Effect.runPromise(Effect.either(transport.listMine()));
  assert.ok(Either.isLeft(unavailable));
  assert.deepEqual(unavailable.left, { _tag: "DeckSharingTransportFailure" });
});

void test("deck sharing rejects malformed caller identifiers before transport", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor(
    { status: 200, body: { schemaVersion: 1, deck: summary, versions: [], canManage: false } },
    seen,
  );
  const result = await Effect.runPromise(Effect.either(api.read("not-a-uuid")));
  assert.ok(Either.isLeft(result));
  assert.deepEqual(result.left, { _tag: "DeckSharingApiFailure", reason: "invalid-request" });
  assert.equal(seen.length, 0);
});

void test("public discovery encodes bounded catalog filters and rejects invalid time ranges", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor(
    { status: 200, body: { schemaVersion: 1, decks: [], nextCursor: null } },
    seen,
  );
  const invalid = await Effect.runPromise(
    Effect.either(api.discover({ minMinutes: 30, maxMinutes: 10 })),
  );
  assert.ok(Either.isLeft(invalid));
  assert.deepEqual(invalid.left, { _tag: "DeckSharingApiFailure", reason: "invalid-request" });
  assert.equal(seen.length, 0);

  const valid = await Effect.runPromise(
    Effect.either(
      api.discover({
        q: "biology",
        language: "en",
        tag: "cells",
        difficulty: "beginner",
        activityType: "recall.quiz",
        minMinutes: 11,
        maxMinutes: 30,
        limit: 10,
      }),
    ),
  );
  assert.ok(Either.isRight(valid));
  assert.equal(
    seen[0]?.path,
    "/api/v1/decks?q=biology&language=en&tag=cells&difficulty=beginner&activityType=recall.quiz&minMinutes=11&maxMinutes=30&limit=10",
  );
});

void test("deck detail response must belong to the requested deck ID", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor(
    {
      status: 200,
      body: {
        schemaVersion: 1,
        deck: { ...summary, id: otherDeckId },
        versions: [],
        canManage: false,
      },
    },
    seen,
  );
  const result = await Effect.runPromise(Effect.either(api.read(deckId)));
  assert.ok(Either.isLeft(result));
  assert.deepEqual(result.left, { _tag: "DeckSharingApiFailure", reason: "invalid-response" });
  assert.deepEqual(seen, [{ method: "GET", path: `/api/v1/decks/${deckId}` }]);
});

void test("deck metadata mutation validates both request and response boundaries", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor({ status: 200, body: { schemaVersion: 1, deck: summary } }, seen);
  const rejected = await Effect.runPromise(
    Effect.either(api.updateDeck("bad-id", { title: "Updated" })),
  );
  assert.ok(Either.isLeft(rejected));
  assert.deepEqual(rejected.left, { _tag: "DeckSharingApiFailure", reason: "invalid-request" });
  assert.equal(seen.length, 0);

  const accepted = await Effect.runPromise(
    Effect.either(api.updateDeck(deckId, { title: "Updated" })),
  );
  assert.ok(Either.isRight(accepted));
  assert.deepEqual(seen[0], {
    method: "PATCH",
    path: `/api/v1/decks/${deckId}`,
    body: { title: "Updated" },
  });
});

void test("named viewer access methods are absent from the public client", () => {
  const api = apiFor({ status: 200, body: {} });
  assert.equal("getAccess" in api, false);
  assert.equal("putAccess" in api, false);
  assert.equal("deleteAccess" in api, false);
});

void test("updates validate bounded rows and mark-read response identity", async () => {
  const update = {
    deckId,
    areaId: otherDeckId,
    knownVersionId: versionId,
    latestVersionId: versionId,
    latestVersion: 2,
    title: "Updated deck",
    releaseNotes: "Changes",
    createdAt: timestamp,
    seen: true,
  };
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor({ status: 200, body: { schemaVersion: 1, updates: [update] } }, seen);
  const invalid = await Effect.runPromise(
    Effect.either(api.markSubscriptionUpdateRead("bad-id", versionId)),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(seen.length, 0);
  const accepted = await Effect.runPromise(
    Effect.either(api.markSubscriptionUpdateRead(otherDeckId, versionId)),
  );
  assert.ok(Either.isRight(accepted));
  assert.deepEqual(seen, [
    {
      method: "POST",
      path: `/api/v1/deck-subscriptions/${otherDeckId}/updates/read`,
      body: { versionId },
    },
  ]);

  const mismatched = apiFor({
    status: 200,
    body: { schemaVersion: 1, updates: [{ ...update, latestVersionId: otherDeckId }] },
  });
  const rejected = await Effect.runPromise(
    Effect.either(mismatched.markSubscriptionUpdateRead(otherDeckId, versionId)),
  );
  assert.ok(Either.isLeft(rejected));
  assert.deepEqual(rejected.left, { _tag: "DeckSharingApiFailure", reason: "invalid-response" });

  const oversized = apiFor({
    status: 200,
    body: { schemaVersion: 1, updates: [{ ...update, releaseNotes: "x".repeat(4001) }] },
  });
  const bounded = await Effect.runPromise(Effect.either(oversized.listSubscriptionUpdates()));
  assert.ok(Either.isLeft(bounded));
  const leakedFollowup = apiFor({
    status: 200,
    body: {
      schemaVersion: 1,
      updates: [
        { ...update, unlistedFollowup: { versionId: otherDeckId, title: "Secret release" } },
      ],
    },
  });
  const leakRejected = await Effect.runPromise(
    Effect.either(leakedFollowup.listSubscriptionUpdates()),
  );
  assert.ok(Either.isLeft(leakRejected));
});

void test("reports require bounded input and canonical idempotency identity", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor(
    { status: 200, body: { schemaVersion: 1, reportId: deckId, status: "open" } },
    seen,
  );
  const bad = await Effect.runPromise(
    Effect.either(
      api.reportDeck(deckId, {
        id: "bad-id",
        versionId,
        reason: "spam",
        message: "Report",
      }),
    ),
  );
  assert.ok(Either.isLeft(bad));
  assert.equal(seen.length, 0);
  const accepted = await Effect.runPromise(
    Effect.either(
      api.reportDeck(deckId, {
        id: deckId,
        versionId,
        reason: "spam",
        message: "Report",
      }),
    ),
  );
  assert.ok(Either.isRight(accepted));
  assert.deepEqual(seen[0], {
    method: "POST",
    path: `/api/v1/decks/${deckId}/reports`,
    body: { id: deckId, versionId, reason: "spam", message: "Report" },
  });
  const mismatch = apiFor({
    status: 200,
    body: { schemaVersion: 1, reportId: otherDeckId, status: "open" },
  });
  const rejected = await Effect.runPromise(
    Effect.either(
      mismatch.reportDeck(deckId, {
        id: deckId,
        versionId,
        reason: "spam",
        message: "Report",
      }),
    ),
  );
  assert.ok(Either.isLeft(rejected));
});

void test("block and moderation clients validate IDs and decode safe responses", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor({ status: 200, body: { schemaVersion: 1, blocked: true } }, seen);
  const rejected = await Effect.runPromise(Effect.either(api.blockDeck("bad-id")));
  assert.ok(Either.isLeft(rejected));
  assert.equal(seen.length, 0);
  const accepted = await Effect.runPromise(Effect.either(api.blockDeck(deckId)));
  assert.ok(Either.isRight(accepted));
  assert.deepEqual(seen[0], { method: "POST", path: `/api/v1/decks/${deckId}/block` });

  const tokenSeen: DeckSharingHttpRequest[] = [];
  const tokenApi = apiFor({ status: 200, body: { schemaVersion: 1, blocked: false } }, tokenSeen);
  const tokenUnblock = await Effect.runPromise(
    Effect.either(tokenApi.unblockDeck(deckId, "A".repeat(43))),
  );
  assert.ok(Either.isRight(tokenUnblock));
  assert.deepEqual(tokenSeen[0], {
    method: "DELETE",
    path: `/api/v1/decks/${deckId}/block`,
    body: { token: "A".repeat(43) },
  });

  const leaked = apiFor({
    status: 200,
    body: {
      schemaVersion: 1,
      reports: [
        {
          id: deckId,
          deckId,
          versionId,
          title: "A",
          reason: "spam",
          message: "Report",
          status: "open",
          createdAt: timestamp,
          leakedUnlistedVersion: otherDeckId,
        },
      ],
    },
  });
  const result = await Effect.runPromise(Effect.either(leaked.listModerationReports()));
  assert.ok(Either.isLeft(result));
});

void test("metadata update response must belong to the requested deck", async () => {
  const api = apiFor({
    status: 200,
    body: { schemaVersion: 1, deck: { ...summary, id: otherDeckId } },
  });
  const result = await Effect.runPromise(
    Effect.either(api.updateDeck(deckId, { title: "Updated" })),
  );
  assert.ok(Either.isLeft(result));
  assert.deepEqual(result.left, { _tag: "DeckSharingApiFailure", reason: "invalid-response" });
});

void test("exact-version unlisted reads keep using the version route and its own token", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = createPublishingApi((request) => {
    seen.push(request);
    return Effect.succeed({
      status: 404,
      body: { schemaVersion: 1, error: "publication-not-found" },
    });
  });
  await Effect.runPromise(Effect.either(api.read(versionId, "A".repeat(43))));
  assert.deepEqual(seen, [
    { method: "GET", path: `/api/v1/published/${versionId}?token=${"A".repeat(43)}` },
  ]);
});

void test("owned deck pagination validates and forwards the cursor", async () => {
  const seen: DeckSharingHttpRequest[] = [];
  const api = apiFor(
    { status: 200, body: { schemaVersion: 1, decks: [], nextCursor: null } },
    seen,
  );
  const invalid = await Effect.runPromise(
    Effect.either(api.listMine({ limit: 51, cursor: "bad-id" })),
  );
  assert.ok(Either.isLeft(invalid));
  assert.deepEqual(invalid.left, { _tag: "DeckSharingApiFailure", reason: "invalid-request" });
  assert.equal(seen.length, 0);

  const result = await Effect.runPromise(
    Effect.either(api.listMine({ limit: 10, cursor: deckId })),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(seen, [{ method: "GET", path: `/api/v1/decks/mine?limit=10&cursor=${deckId}` }]);
});
