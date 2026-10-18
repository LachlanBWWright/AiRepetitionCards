import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  emptyActivityLibrary,
  type ActivityLibrary,
  type ActivityResponse,
  type LearningAttempt,
} from "@recall/domain";
import {
  acceptLearningAttempt,
  addLearningActivity,
  assessLearningActivity,
  authorLearningActivity,
  builtinActivityRegistry,
  decodeActivityLibrary,
  mergeActivityLibraries,
  recommendLearningActivities,
  reviseLearningActivity,
  summarizeUnderstanding,
  upgradeLearningActivity,
  validateLearningActivity,
  type ActivityPlugin,
} from "@recall/application";

async function success<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}

const choiceInput = {
  id: "choice",
  areaId: "deck",
  title: "Queue recognition",
  pluginId: "recall.multiple-choice",
  objectiveId: "queues",
  fields: {
    prompt: "Which is FIFO?",
    options: "Stack\nQueue\nSet",
    correct: "2",
    reference: "Queues process the oldest element first.",
  },
};
const response: ActivityResponse = {
  answers: [],
  selectedOptionIds: ["2"],
  selfScore: 0.5,
  assistance: "none",
};
const startedAt = "2026-10-13T09:00:00.000Z";
const submittedAt = "2026-10-13T09:01:00.000Z";
const acceptedAt = "2026-10-13T09:02:00.000Z";

async function choiceAttempt(): Promise<{
  readonly library: ActivityLibrary;
  readonly attempt: LearningAttempt;
}> {
  const activity = await success(authorLearningActivity(choiceInput));
  const library = await success(addLearningActivity(emptyActivityLibrary, activity));
  const result = await success(assessLearningActivity(activity, response));
  return {
    library,
    attempt: { id: "attempt", activity, response, result, startedAt, submittedAt, acceptedAt },
  };
}

await test("explicit version migrations preserve identity while incrementing the content revision", async () => {
  const activity = await success(authorLearningActivity(choiceInput));
  const base = builtinActivityRegistry.find((plugin) => plugin.id === activity.pluginId);
  assert.ok(base);
  const upgrade: ActivityPlugin = {
    ...base,
    version: 2,
    migrate: (payload) => Effect.succeed(payload),
  };
  const migrated = await success(upgradeLearningActivity(activity, 2, [base, upgrade]));
  assert.equal(migrated.id, activity.id);
  assert.equal(migrated.pluginVersion, 2);
  assert.equal(migrated.revision, 2);
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(Effect.either(upgradeLearningActivity(migrated, 1, [base, upgrade]))),
    ),
  );
});
await test("external JSON and plugin-specific authoring are validated before use", async () => {
  for (const fields of [
    { ...choiceInput.fields, correct: "9" },
    { ...choiceInput.fields, options: "Only one" },
    { ...choiceInput.fields, correct: "2,2" },
  ])
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(Effect.either(authorLearningActivity({ ...choiceInput, fields }))),
      ),
    );
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(validateLearningActivity(cyclic)))),
  );
  const { attempt } = await choiceAttempt();
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          validateLearningActivity({ ...attempt.activity, payload: { run: () => 42 } }),
        ),
      ),
    ),
  );
});

await test("understanding uses assessment confidence and leaves zero-confidence evidence unassessed", async () => {
  const { attempt } = await choiceAttempt();
  const evidenceAttempt = (id: string, score: number, confidence: number): LearningAttempt => ({
    ...attempt,
    id,
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({ ...entry, score, confidence })),
    },
  });
  const summaries = summarizeUnderstanding(
    [evidenceAttempt("strong", 1, 0.9), evidenceAttempt("weak", 0, 0.1)],
    "queues",
  );
  assert.equal(summaries.find((entry) => entry.dimension === "recognition")?.value, 0.9);
  const uncertain = summarizeUnderstanding([evidenceAttempt("unassessed", 0, 0)], "queues");
  assert.equal(uncertain.find((entry) => entry.dimension === "recognition")?.value, null);
  assert.ok(
    summarizeUnderstanding([attempt], "unrelated-objective").every((entry) => entry.value === null),
  );
});

await test("acceptance rejects assistance mismatches, repeated dimensions and unsupported graders", async () => {
  const { library, attempt } = await choiceAttempt();
  for (const evidence of [
    attempt.result.evidence.map((entry) => ({ ...entry, assistance: "hint" as const })),
    [...attempt.result.evidence, ...attempt.result.evidence],
    attempt.result.evidence.map((entry) => ({ ...entry, assessment: "ai" as const })),
  ]) {
    const accepted = await Effect.runPromise(
      Effect.either(
        acceptLearningAttempt(library, { ...attempt, result: { ...attempt.result, evidence } }),
      ),
    );
    assert.ok(Either.isLeft(accepted));
    assert.equal(accepted.left.reason, "invalid-input");
  }
  assert.equal(library.attempts.length, 0);
});

await test("imported libraries reject ambiguous identities, backwards drafts and inconsistent evidence", async () => {
  const { library, attempt } = await choiceAttempt();
  const draft = {
    id: "draft",
    activity: attempt.activity,
    response,
    stage: 0,
    startedAt,
    updatedAt: submittedAt,
  };
  const editor = {
    id: "editor",
    areaId: "deck",
    title: "",
    pluginId: "recall.short-answer",
    objectiveId: "queues",
    fields: {},
    updatedAt: submittedAt,
  };
  const malformed: readonly unknown[] = [
    { ...library, activities: [{ ...attempt.activity, objectiveIds: ["queues", "queues"] }] },
    { ...library, drafts: [draft, draft] },
    { ...library, editorDrafts: [editor, editor] },
    { ...library, drafts: [{ ...draft, updatedAt: "2026-10-12T09:00:00.000Z" }] },
    ...[
      attempt.result.evidence.map((entry) => ({ ...entry, objectiveId: "another" })),
      attempt.result.evidence.map((entry) => ({ ...entry, assistance: "hint" as const })),
      [...attempt.result.evidence, ...attempt.result.evidence],
    ].map((evidence) => ({
      ...library,
      attempts: [{ ...attempt, result: { ...attempt.result, evidence } }],
    })),
  ];
  for (const input of malformed)
    assert.ok(Either.isLeft(await Effect.runPromise(Effect.either(decodeActivityLibrary(input)))));
});

await test("synchronized equal-time divergent drafts conflict rather than silently losing learner work", async () => {
  const { library, attempt } = await choiceAttempt();
  const draft = {
    id: "draft",
    activity: attempt.activity,
    response,
    stage: 0,
    startedAt,
    updatedAt: submittedAt,
  };
  const local = { ...library, drafts: [draft] };
  const remote = {
    ...library,
    drafts: [{ ...draft, response: { ...response, selectedOptionIds: ["1"] } }],
  };
  const merged = await Effect.runPromise(Effect.either(mergeActivityLibraries(local, remote)));
  assert.ok(Either.isLeft(merged));
  assert.equal(merged.left.reason, "conflict");
  assert.deepEqual(local.drafts[0]?.response, response);
});

await test("revisions require new evidence and archived activities retain idempotent historical receipts", async () => {
  const { library, attempt } = await choiceAttempt();
  const accepted = await success(acceptLearningAttempt(library, attempt));
  const revised = await success(
    reviseLearningActivity(
      accepted,
      { ...attempt.activity, revision: 2, title: "New challenge" },
      1,
    ),
  );
  assert.equal(
    recommendLearningActivities(revised, "deck", Date.parse(acceptedAt))[0]?.reason,
    "No attempt yet",
  );
  const archived = await success(
    reviseLearningActivity(accepted, { ...attempt.activity, revision: 2, archived: true }, 1),
  );
  assert.deepEqual(await success(acceptLearningAttempt(archived, attempt)), archived);
  const archivedActivity = archived.activities[0];
  assert.ok(archivedActivity);
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          acceptLearningAttempt(archived, { ...attempt, id: "new", activity: archivedActivity }),
        ),
      ),
    ),
  );
  assert.equal(recommendLearningActivities(archived, "deck", Date.parse(acceptedAt)).length, 0);
});

await test("self-rubric assessment cannot replace or truncate the original questions", async () => {
  const activity = await success(
    authorLearningActivity({
      id: "short",
      areaId: "deck",
      title: "Explain",
      pluginId: "recall.short-answer",
      objectiveId: "queues",
      fields: {
        prompt: "Explain FIFO.\n\nApply FIFO.",
        rubric: "Explain and apply",
        reference: "Oldest first",
      },
    }),
  );
  for (const presentedPrompts of [["Easier prompt", "Apply FIFO."], ["Explain FIFO."]]) {
    const result = await Effect.runPromise(
      Effect.either(
        assessLearningActivity(activity, {
          ...response,
          selectedOptionIds: [],
          answers: ["Answer one", "Answer two"],
          presentedPrompts,
        }),
      ),
    );
    assert.ok(Either.isLeft(result));
  }
});
