import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createReviewEventId, type StudySyncDocument } from "@recall/domain";
import {
  readStudyPages,
  writeStudyBatches,
} from "../../../application/src/workspace/sync/study-pages";
import type {
  WorkspaceSyncRequest,
  WorkspaceSyncFailure,
  WorkspaceSyncResponse,
} from "@recall/application";
const empty = (): StudySyncDocument => ({
  settings: { requestRetention: 0.9 },
  adjustments: [],
  corrections: [],
  undoStates: [],
  importedSchedules: [],
});
const correction = (index: number) => ({
  id: `correction-${String(index)}`,
  eventId: createReviewEventId(`event-${String(index)}`),
  recordedAt: "2026-10-22T00:00:00.000Z",
});
type Request = (
  input: WorkspaceSyncRequest,
) => Effect.Effect<WorkspaceSyncResponse, WorkspaceSyncFailure>;
await test("paged metadata reads preserve history beyond the old twenty-thousand boundary", () => {
  const events = Array.from({ length: 20_001 }, (_, index) => correction(index));
  let calls = 0;
  const request: Request = (input) => {
    const offset = Number(input.path.split("after=")[1]);
    calls += 1;
    return Effect.succeed({
      status: 200,
      body: {
        revision: 7,
        document: { ...empty(), corrections: events.slice(offset, offset + 5_000) },
        nextCursor: offset + 5_000 < events.length ? offset + 5_000 : null,
      },
    });
  };
  const result = Effect.runSync(readStudyPages(request));
  assert.equal(result.document.corrections.length, 20_001);
  assert.equal(calls, 5);
});
await test("paged reads reject revision changes and nonadvancing cursors", () => {
  for (const mode of ["revision", "cursor"]) {
    let calls = 0;
    const request: Request = () =>
      Effect.succeed({
        status: 200,
        body: {
          revision: mode === "revision" ? calls++ : 1,
          document: empty(),
          nextCursor: mode === "cursor" ? 0 : 1,
        },
      });
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(readStudyPages(request)))));
  }
});
await test("metadata uploads send only new entries in bounded revision-checked batches", () => {
  const remote = { ...empty(), corrections: [correction(0)] };
  const document = {
    ...empty(),
    corrections: Array.from({ length: 10_002 }, (_, i) => correction(i)),
  };
  const requests: WorkspaceSyncRequest[] = [];
  const request: Request = (input) => {
    requests.push(input);
    return Effect.succeed({ status: 200, body: { revision: requests.length + 3 } });
  };
  assert.equal(Effect.runSync(writeStudyBatches(request, 3, document, remote)), 6);
  const bodies = requests.map((input) => {
    assert.ok(input.body !== null && typeof input.body === "object" && "document" in input.body);
    const batch = input.body.document;
    assert.ok(
      batch !== null &&
        typeof batch === "object" &&
        "corrections" in batch &&
        Array.isArray(batch.corrections),
    );
    assert.ok(batch.corrections.length <= 5_000);
    assert.ok(new TextEncoder().encode(JSON.stringify(input.body)).byteLength < 5_000_000);
    const entries: readonly unknown[] = batch.corrections;
    return entries;
  });
  assert.deepEqual(bodies.flat(), document.corrections.slice(1));
});
await test("metadata uploads stop on a conflict without acknowledging later batches", () => {
  let calls = 0;
  const request: Request = () => {
    calls += 1;
    return Effect.succeed({ status: 409, body: {} });
  };
  const result = Effect.runSync(
    Effect.either(
      writeStudyBatches(request, 1, { ...empty(), corrections: [correction(1)] }, empty()),
    ),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(calls, 1);
});
