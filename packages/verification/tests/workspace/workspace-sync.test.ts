import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { MediaIdSchema } from "@recall/domain";
import { syncWorkspace } from "@recall/application";
import { decode, owner, server, uuid, workspace } from "./workspace-sync-fixtures.js";

await test("fresh ownership is durably checkpointed before content, media or review mutations", () => {
  const remote = server();
  const local = workspace();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const reference = {
    id: decode(MediaIdSchema, createHash("sha256").update(bytes).digest("hex")),
    mimeType: "image/png" as const,
    byteLength: bytes.length,
  };
  const mediaWorkspace = {
    ...local,
    areas: local.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({ ...card, media: [reference] })),
    })),
  };
  const input = remote.input(mediaWorkspace);
  const result = Effect.runSync(
    syncWorkspace({
      ...input,
      mediaStore: { ...input.mediaStore, get: () => Effect.succeed({ reference, bytes }) },
    }),
  );
  assert.equal(result._tag, "Synced");
  assert.equal(remote.getCheckpoint()?.syncOwnerId, owner);
  assert.ok(remote.uploads.length > 0);
  assert.equal(remote.reviews.size, 1);
  assert.equal(local.syncOwnerId, undefined);
});

await test("failed owner checkpoint and another canonical account stop all cloud writes", () => {
  const failed = server();
  const failedResult = Effect.runSync(
    Effect.either(syncWorkspace(failed.input(workspace(), true))),
  );
  assert.ok(Either.isLeft(failedResult));
  assert.equal(failedResult.left.reason, "ownership-checkpoint");
  assert.equal(failed.requests.filter((request) => request.method === "POST").length, 0);
  const different = server({ ownerId: uuid(8) });
  const mismatch = Effect.runSync(
    Effect.either(syncWorkspace(different.input({ ...workspace(), syncOwnerId: owner }))),
  );
  assert.ok(Either.isLeft(mismatch));
  assert.equal(mismatch.left.reason, "account-mismatch");
  assert.equal(different.getCheckpoint(), undefined);
  assert.equal(different.requests.filter((request) => request.method === "POST").length, 0);
});

await test("an account change at the mutation boundary rejects upload after binding without discarding offline data", () => {
  const local = workspace();
  const remote = server({ accountChangesAtContent: true });
  const result = Effect.runSync(Effect.either(syncWorkspace(remote.input(local))));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "account-changed");
  assert.equal(remote.getCheckpoint()?.syncOwnerId, owner);
  assert.equal(remote.documents.size, 0);
  assert.equal(remote.reviews.size, 0);
  assert.equal(local.pendingReviewEventIds?.length, 1);
});
