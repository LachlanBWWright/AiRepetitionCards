import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { emptyActivityLibrary } from "@recall/domain";
import {
  authorLearningActivity,
  addLearningActivity,
  assessLearningActivity,
  acceptLearningAttempt,
  mergeActivityLibraries,
  reviseLearningActivity,
  recommendLearningActivities,
  createActivityServices,
  registerActivityPlugins,
  builtinActivityRegistry,
  decodeActivityLibrary,
} from "@recall/application";
const activity = await Effect.runPromise(
  authorLearningActivity({
    id: "activity",
    areaId: "deck",
    title: "Question",
    pluginId: "recall.multiple-choice",
    objectiveId: "objective",
    fields: { prompt: "Choose.", options: "Yes\nNo", correct: "1", reference: "Yes." },
  }),
);
const library = await Effect.runPromise(addLearningActivity(emptyActivityLibrary, activity));
const response = {
  answers: [],
  selectedOptionIds: ["1"],
  selfScore: 0.5,
  assistance: "none",
} as const;
const result = await Effect.runPromise(assessLearningActivity(activity, response));
const at = "2026-10-13T09:00:00.000Z";
const attempt = {
  id: "attempt",
  activity,
  response,
  result,
  startedAt: at,
  submittedAt: at,
  acceptedAt: at,
};
await test("activity synchronization unions immutable attempts and conflicts on divergent content revisions", async () => {
  const recorded = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const merged = await Effect.runPromise(mergeActivityLibraries(library, recorded));
  assert.equal(merged.attempts.length, 1);
  const conflicting = {
    ...recorded,
    attempts: [{ ...attempt, result: { ...result, feedback: "Changed immutable feedback" } }],
  };
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(Effect.either(mergeActivityLibraries(recorded, conflicting))),
    ),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          mergeActivityLibraries(library, {
            ...library,
            activities: [{ ...activity, title: "Different concurrent title" }],
          }),
        ),
      ),
    ),
  );
});
await test("activity edit retries are idempotent and prior accepted snapshots remain unchanged", async () => {
  const recorded = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const updated = { ...activity, title: "Edited", revision: 2 };
  const changed = await Effect.runPromise(reviseLearningActivity(recorded, updated, 1));
  const retry = await Effect.runPromise(reviseLearningActivity(changed, updated, 1));
  assert.deepEqual(changed, retry);
  assert.equal(changed.attempts[0]?.activity.title, "Question");
});
await test("completed attempts and saved activity revisions retire their corresponding unfinished drafts", async () => {
  const local = {
    ...library,
    drafts: [{ id: attempt.id, activity, response, stage: 0, startedAt: at, updatedAt: at }],
    editorDrafts: [
      {
        id: activity.id,
        areaId: activity.areaId,
        title: "",
        pluginId: activity.pluginId,
        objectiveId: "objective",
        fields: {},
        updatedAt: at,
      },
    ],
  };
  const remote = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const merged = await Effect.runPromise(mergeActivityLibraries(local, remote));
  assert.equal(merged.drafts?.length, 0);
  assert.equal(merged.editorDrafts?.length, 0);
  const divergentStaleDraft = {
    id: attempt.id,
    activity,
    stage: 0,
    startedAt: at,
    updatedAt: at,
    response: { ...response, selectedOptionIds: ["2"] },
  };
  const completedWithStaleDraft = { ...remote, drafts: [divergentStaleDraft] };
  const reconciled = await Effect.runPromise(
    mergeActivityLibraries(local, completedWithStaleDraft),
  );
  assert.equal(reconciled.attempts.length, 1);
  assert.equal(reconciled.drafts?.length, 0);
});
await test("HTTP service retries a compare-and-swap conflict and validates external assessment responses", async () => {
  let writes = 0;
  const services = createActivityServices((request) => {
    if (request.method === "GET")
      return Effect.succeed({ status: 200, body: { revision: 1, library } });
    if (request.path.endsWith("/assess"))
      return Effect.succeed({ status: 200, body: { ...result, evidence: [{ score: 3 }] } });
    writes += 1;
    return Effect.succeed(
      writes === 1
        ? { status: 409, body: { error: "conflict" } }
        : { status: 200, body: { revision: 2, library } },
    );
  });
  const synced = await Effect.runPromise(services.sync(library));
  assert.equal(synced.activities.length, 1);
  assert.equal(writes, 2);
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(services.assess(activity, response)))),
  );
});
await test("recommendations prioritize unassessed and assisted work without changing review state", async () => {
  const original = structuredClone(library);
  assert.equal(
    recommendLearningActivities(library, "deck", Date.parse(at))[0]?.reason,
    "No attempt yet",
  );
  const assisted = {
    ...attempt,
    response: { ...response, assistance: "hint" as const },
    result: {
      ...result,
      evidence: result.evidence.map((entry) => ({ ...entry, assistance: "hint" as const })),
    },
  };
  const recorded = await Effect.runPromise(acceptLearningAttempt(library, assisted));
  assert.ok(
    recommendLearningActivities(recorded, "deck", Date.parse(at))[0]?.reason.includes(
      "independently",
    ),
  );
  assert.deepEqual(library, original);
});
await test("plugin composition rejects duplicate identities rather than installing code from content", async () => {
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          registerActivityPlugins([...builtinActivityRegistry, ...builtinActivityRegistry]),
        ),
      ),
    ),
  );
  assert.ok(
    Either.isRight(
      await Effect.runPromise(Effect.either(registerActivityPlugins(builtinActivityRegistry))),
    ),
  );
});

await test("synchronization retries merge against each fresh remote snapshot and retain concurrent attempts", async () => {
  const local = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const remoteAttempt = { ...attempt, id: "remote-attempt" };
  const remote = await Effect.runPromise(acceptLearningAttempt(library, remoteAttempt));
  let reads = 0;
  let writes = 0;
  const services = createActivityServices((request) =>
    Effect.suspend((): Effect.Effect<{ readonly status: number; readonly body: unknown }> => {
      if (request.method === "GET") {
        reads += 1;
        return Effect.succeed({
          status: 200,
          body: { revision: reads, library: reads === 1 ? library : remote },
        });
      }
      writes += 1;
      if (writes === 1) return Effect.succeed({ status: 409, body: { error: "conflict" } });
      const body = request.body;
      assert.ok(
        typeof body === "object" && body !== null && "library" in body && "revision" in body,
      );
      assert.equal(body.revision, 2);
      return Effect.succeed({ status: 200, body: { revision: 3, library: body.library } });
    }),
  );
  const synced = await Effect.runPromise(services.sync(local));
  assert.deepEqual(
    synced.attempts.map((entry) => entry.id),
    ["attempt", "remote-attempt"],
  );
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(local.attempts.length, 1);
  assert.equal(remote.attempts.length, 1);
});

await test("persistent synchronization conflicts stop after three writes without mutating local history", async () => {
  const local = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const original = structuredClone(local);
  let reads = 0;
  let writes = 0;
  const services = createActivityServices((request) =>
    Effect.suspend((): Effect.Effect<{ readonly status: number; readonly body: unknown }> => {
      if (request.method === "GET") {
        reads += 1;
        return Effect.succeed({ status: 200, body: { revision: reads, library } });
      }
      writes += 1;
      return Effect.succeed({ status: 409, body: { error: "conflict" } });
    }),
  );
  const synced = await Effect.runPromise(Effect.either(services.sync(local)));
  assert.ok(Either.isLeft(synced));
  assert.equal(synced.left.reason, "conflict");
  assert.equal(reads, 3);
  assert.equal(writes, 3);
  assert.deepEqual(local, original);
});

await test("JSON round trips preserve unknown plugin payloads, old attempt revisions and unfinished responses", async () => {
  const recorded = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const revised = await Effect.runPromise(
    reviseLearningActivity(recorded, { ...activity, title: "New prompt", revision: 2 }, 1),
  );
  const portable = {
    ...revised,
    activities: [
      ...revised.activities,
      {
        ...activity,
        id: "unknown-plugin",
        pluginId: "community.diagram",
        pluginVersion: 8,
        payload: { nodes: [{ label: "Question", related: [true, null, 4] }] },
      },
    ],
    drafts: [{ id: "unfinished", activity, response, stage: 0, startedAt: at, updatedAt: at }],
  };
  const restored = await Effect.runPromise(
    decodeActivityLibrary(JSON.parse(JSON.stringify(portable))),
  );
  assert.deepEqual(restored, portable);
  const merged = await Effect.runPromise(mergeActivityLibraries(restored, revised));
  assert.equal(merged.activities.find((entry) => entry.id === activity.id)?.revision, 2);
  assert.equal(merged.attempts[0]?.activity.revision, 1);
  assert.equal(merged.drafts?.[0]?.response.selectedOptionIds[0], "1");
  assert.equal(merged.activities.find((entry) => entry.id === "unknown-plugin")?.pluginVersion, 8);
});

await test("service failures reject invalid snapshots and bounded interrogation questions before using them", async () => {
  for (const body of [
    null,
    { revision: -1, library },
    { revision: 1, library: { ...library, version: 9 } },
  ]) {
    const services = createActivityServices(() => Effect.succeed({ status: 200, body }));
    assert.ok(Either.isLeft(await Effect.runPromise(Effect.either(services.read))));
  }
  for (const question of ["", "x".repeat(2001), 7]) {
    const services = createActivityServices(() =>
      Effect.succeed({ status: 200, body: { question } }),
    );
    assert.ok(
      Either.isLeft(await Effect.runPromise(Effect.either(services.question(activity, response)))),
    );
  }
  const unavailable = createActivityServices(() =>
    Effect.succeed({ status: 503, body: { error: "Evaluator unavailable" } }),
  );
  const assessed = await Effect.runPromise(Effect.either(unavailable.assess(activity, response)));
  assert.ok(Either.isLeft(assessed));
  assert.equal(assessed.left.reason, "assessment-unavailable");
  assert.equal(assessed.left.message, "Evaluator unavailable");
});
