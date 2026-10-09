import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { Deferred, Effect, Either, Schema } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import { WorkspaceContentPushRequestSchema, type WorkspaceSnapshot } from "@recall/contracts";
import {
  applyWorkspaceAuthoringCommand,
  applyWorkspaceSyncChanges,
  syncWorkspace,
  type WorkspaceSyncInput,
  type WorkspaceSyncRequest,
} from "@recall/application";
import { prepareWorkspaceForSync } from "@recall/sync-core";
import { newSchedule } from "@recall/scheduler";

const now = new Date("2026-10-05T00:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(90);
const areaId = createAreaId(uuid(1));
const cardId = createAssessmentId(uuid(2));
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function initial(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      {
        id: areaId,
        title: "Go",
        color: "#123456",
        cards: [
          {
            id: cardId,
            front: "Q",
            back: "Original answer",
            objective: "General",
            schedule: newSchedule(now),
          },
        ],
      },
    ],
  };
}
function edit(workspace: Workspace, back: string): Workspace {
  return success(
    applyWorkspaceAuthoringCommand(
      workspace,
      {
        kind: "update-card",
        areaId,
        cardId,
        content: { kind: "basic", front: "Q", back, objectiveIds: [], tags: [], media: [] },
      },
      now,
    ),
  ).workspace;
}
function server() {
  let areas: WorkspaceSnapshot["areas"] = [];
  const posts: WorkspaceSyncRequest[] = [];
  const input = (
    workspace: Workspace,
    checkpoint: WorkspaceSyncInput["checkpoint"],
  ): WorkspaceSyncInput => ({
    workspace,
    checkpoint,
    now,
    createId: () => uuid(99),
    mediaStore: {
      get: () => Effect.succeed(null),
      put: () => Effect.void,
      delete: () => Effect.void,
      list: Effect.succeed([]),
    },
    mediaGatewayForOwner: () => ({ upload: () => Effect.void, read: () => Effect.succeed(null) }),
    transport: (request) =>
      Effect.sync(() => {
        if (request.method === "POST") posts.push(request);
        if (request.path === "/api/v1/workspace" && request.method === "GET")
          return {
            status: 200,
            body: { schemaVersion: 1, ownerId: owner, areas, deletedAreaIds: [] },
          };
        if (request.path === "/api/v1/workspace" && request.method === "POST") {
          const decoded = Schema.decodeUnknownEither(WorkspaceContentPushRequestSchema)(
            request.body,
          );
          assert.ok(Either.isRight(decoded));
          areas = decoded.right.areas.map((area) => ({
            ...area,
            contentHash: createHash("sha256").update(JSON.stringify(area.document)).digest("hex"),
          }));
          return {
            status: 200,
            body: {
              schemaVersion: 1,
              syncedAreas: areas.length,
              syncedCards: areas.reduce((total, area) => total + area.document.cards.length, 0),
            },
          };
        }
        if (request.path === "/api/v1/sync" && request.method === "POST")
          return {
            status: 200,
            body: {
              schemaVersion: 1,
              acceptedIds: [],
              acceptedReviewEvents: [],
              conflicts: [],
              cursor: "0",
            },
          };
        if (request.path.startsWith("/api/v1/sync?"))
          return {
            status: 200,
            body: { schemaVersion: 1, cursor: "0", hasMore: false, changes: [] },
          };
        assert.fail(`Unexpected request ${request.path}`);
      }),
  });
  return { input, posts };
}

await test("a blocked ownership checkpoint uploads the latest edit and its history only after durable release", async () => {
  const remote = server();
  const old = initial();
  const entered = Effect.runSync(Deferred.make<undefined>());
  const release = Effect.runSync(Deferred.make<Workspace>());
  const operation = Effect.runPromise(
    syncWorkspace(
      remote.input(old, () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          return yield* Deferred.await(release);
        }),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(entered));
  assert.equal(remote.posts.length, 0);
  const latest = { ...edit(old, "Edited while checkpoint was blocked"), syncOwnerId: owner };
  await Effect.runPromise(Deferred.succeed(release, latest));
  const result = await operation;
  assert.equal(result._tag, "Synced");
  assert.equal(result.workspace.areas[0]?.cards[0]?.back, "Edited while checkpoint was blocked");
  assert.deepEqual(
    result.workspace.cardVersions,
    prepareWorkspaceForSync(latest, () => uuid(99)).cardVersions,
  );
  const pushed = Schema.decodeUnknownEither(WorkspaceContentPushRequestSchema)(
    remote.posts[0]?.body,
  );
  assert.ok(Either.isRight(pushed));
  const pushedCard = pushed.right.areas[0]?.document.cards[0];
  assert.ok(pushedCard?.kind === "basic");
  assert.equal(pushedCard.back, "Edited while checkpoint was blocked");
  assert.ok(!JSON.stringify(pushed.right).includes("cardVersions"));
  assert.equal(old.cardVersions, undefined);
});

await test("an account switch while the checkpoint is blocked prevents every cloud mutation", async () => {
  const remote = server();
  const entered = Effect.runSync(Deferred.make<undefined>());
  const release = Effect.runSync(Deferred.make<Workspace>());
  const original = edit(initial(), "Private revision");
  const operation = Effect.runPromise(
    Effect.either(
      syncWorkspace(
        remote.input(original, () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            return yield* Deferred.await(release);
          }),
        ),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(entered));
  await Effect.runPromise(Deferred.succeed(release, { ...original, syncOwnerId: uuid(91) }));
  const result = await operation;
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "ownership-checkpoint");
  assert.equal(remote.posts.length, 0);
  assert.equal(original.cardVersions?.[0]?.card.back, "Original answer");
});

await test("an old completed sync cannot overwrite a later edit or erase its version history", () => {
  const remote = server();
  const snapshot = { ...initial(), syncOwnerId: owner };
  const response = success(syncWorkspace(remote.input(snapshot, Effect.succeed)));
  assert.ok(response._tag === "Synced");
  const latest = edit(snapshot, "Later local revision");
  const applied = success(applyWorkspaceSyncChanges(latest, response, () => uuid(99)));
  assert.equal(applied.areas[0]?.cards[0]?.back, "Later local revision");
  assert.deepEqual(
    applied.cardVersions,
    prepareWorkspaceForSync(latest, () => uuid(99)).cardVersions,
  );
  assert.deepEqual(applied.syncContentConflictAreaIds ?? [], []);
  const switched = { ...latest, syncOwnerId: uuid(91) };
  const rejected = Effect.runSync(
    Effect.either(applyWorkspaceSyncChanges(switched, response, () => uuid(99))),
  );
  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.reason, "account-mismatch");
  assert.deepEqual(switched.cardVersions, latest.cardVersions);
});
