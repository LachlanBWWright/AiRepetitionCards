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
  presentLearningActivity,
  summarizeUnderstanding,
  diagnoseLearningObjectives,
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
await test("multiple choice grades exact matches and retains recognition rather than recall evidence", async () => {
  const activity = await success(authorLearningActivity(choiceInput));
  const correct = await success(assessLearningActivity(activity, response));
  assert.equal(correct.evidence[0]?.score, 1);
  assert.equal(correct.evidence[0].dimension, "recognition");
  assert.equal(correct.evidence[0].assessment, "deterministic");
  const wrong = await success(
    assessLearningActivity(activity, { ...response, selectedOptionIds: ["1", "2"] }),
  );
  assert.equal(wrong.evidence[0]?.score, 0);
  for (const selectedOptionIds of [[], ["missing"], ["2", "2"]])
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(activity, { ...response, selectedOptionIds })),
        ),
      ),
    );
});
await test("coding submissions are stored as text and assessed only against an explicit self rubric", async () => {
  const activity = await success(
    authorLearningActivity({
      id: "code",
      areaId: "deck",
      title: "Sum",
      pluginId: "recall.coding",
      objectiveId: "iteration",
      fields: {
        prompt: "Implement sum.",
        rubric: "Handle empty input and explain complexity.",
        reference: "A linear fold.",
      },
    }),
  );
  const result = await success(
    assessLearningActivity(activity, {
      answers: ["while (true) {} // Never execute this learner code during self-assessment."],
      selectedOptionIds: [],
      selfScore: 1,
      assistance: "none",
    }),
  );
  assert.equal(result.evidence[0]?.assessment, "self");
  assert.equal(result.evidence[0].dimension, "application");
  assert.equal(result.evidence[0].confidence, 0.4);
  assert.ok(result.feedback.includes("does not independently verify"));
});
await test("interrogation stages require all answers and carry assistance into evidence", async () => {
  const activity = await success(
    authorLearningActivity({
      id: "interrogate",
      areaId: "deck",
      title: "Explain and transfer",
      pluginId: "recall.interrogation",
      objectiveId: "queues",
      fields: {
        prompt: "Explain queues.\n\nGive a new example.",
        rubric: "Explain and apply the concept.",
        reference: "FIFO.",
      },
    }),
  );
  const presentation = await success(presentLearningActivity(activity));
  assert.equal(presentation.prompts.length, 2);
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          assessLearningActivity(activity, {
            ...response,
            answers: ["First answer"],
            selectedOptionIds: [],
          }),
        ),
      ),
    ),
  );
  const result = await success(
    assessLearningActivity(activity, {
      ...response,
      answers: ["FIFO.", "Waiting customers."],
      selectedOptionIds: [],
      assistance: "answer-revealed",
    }),
  );
  assert.equal(result.evidence[0]?.assistance, "answer-revealed");
});
await test("acceptance appends immutable content snapshots and retries idempotently without replacing history", async () => {
  const { library, attempt } = await choiceAttempt();
  const original = structuredClone(library);
  const accepted = await success(acceptLearningAttempt(library, attempt));
  assert.deepEqual(library, original);
  assert.equal(accepted.attempts.length, 1);
  assert.deepEqual(accepted.attempts[0]?.activity, attempt.activity);
  const retried = await success(acceptLearningAttempt(accepted, attempt));
  assert.deepEqual(retried, accepted);
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          acceptLearningAttempt(accepted, {
            ...attempt,
            response: { ...response, selectedOptionIds: ["1"] },
          }),
        ),
      ),
    ),
  );
  assert.deepEqual(await success(addLearningActivity(library, attempt.activity)), library);
});
await test("stale activity revisions and invalid evidence cannot enter accepted history", async () => {
  const { library, attempt } = await choiceAttempt();
  const changed = {
    ...library,
    activities: library.activities.map((activity) => ({ ...activity, revision: 2 })),
  };
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(acceptLearningAttempt(changed, attempt)))),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(acceptLearningAttempt(library, { ...attempt, acceptedAt: startedAt })),
      ),
    ),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          acceptLearningAttempt(library, {
            ...attempt,
            result: {
              ...attempt.result,
              evidence: attempt.result.evidence.map((entry) => ({
                ...entry,
                objectiveId: "other",
              })),
            },
          }),
        ),
      ),
    ),
  );
});
await test("unknown plugin data remains portable but is unavailable for assessment", async () => {
  const { library, attempt } = await choiceAttempt();
  const unknown = {
    ...attempt.activity,
    pluginId: "community.diagram",
    pluginVersion: 17,
    payload: { nodes: [{ label: "Arbitrary content", weight: 0.5 }], enabled: true },
  };
  const restored = await success(decodeActivityLibrary({ ...library, activities: [unknown] }));
  assert.deepEqual(restored.activities[0], unknown);
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(presentLearningActivity(unknown)))),
  );
});
await test("trusted evaluator extensions must return bounded evidence for the requested objectives", async () => {
  const { attempt } = await choiceAttempt();
  const base = builtinActivityRegistry.find((plugin) => plugin.id === "recall.multiple-choice");
  assert.ok(base);
  for (const evidence of [
    attempt.result.evidence.map((entry) => ({ ...entry, score: 2 })),
    attempt.result.evidence.map((entry) => ({ ...entry, objectiveId: "other" })),
    [...attempt.result.evidence, ...attempt.result.evidence],
    attempt.result.evidence.map((entry) => ({ ...entry, assessment: "ai" as const })),
  ]) {
    const plugin: ActivityPlugin = {
      ...base,
      assess: () => Effect.succeed({ ...attempt.result, evidence }),
    };
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(attempt.activity, response, [plugin])),
        ),
      ),
    );
  }
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(assessLearningActivity(attempt.activity, response, [base, base])),
      ),
    ),
  );
});
await test("understanding projections keep self reports and assistance separate and unknown dimensions unassessed", async () => {
  const { attempt } = await choiceAttempt();
  const self = {
    ...attempt,
    id: "self",
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({
        ...entry,
        dimension: "application" as const,
        assessment: "self" as const,
      })),
    },
  };
  const assisted = {
    ...attempt,
    id: "assisted",
    response: { ...response, assistance: "hint" as const },
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({
        ...entry,
        score: 0,
        assistance: "hint" as const,
      })),
    },
  };
  const summaries = summarizeUnderstanding([attempt, self, assisted], "queues");
  assert.equal(summaries.find((entry) => entry.dimension === "recognition")?.value, 1);
  assert.equal(summaries.find((entry) => entry.dimension === "recognition")?.assisted, 1);
  assert.equal(summaries.find((entry) => entry.dimension === "application")?.value, null);
  assert.equal(summaries.find((entry) => entry.dimension === "application")?.selfReports, 1);
  assert.equal(summaries.find((entry) => entry.dimension === "transfer")?.value, null);
});
await test("objective diagnostics separate independent evidence and recommend targeted practice", async () => {
  const { attempt } = await choiceAttempt();
  const self = {
    ...attempt,
    id: "self-report",
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({
        ...entry,
        assessment: "self" as const,
      })),
    },
  };
  const assisted = {
    ...attempt,
    id: "assisted",
    response: { ...response, assistance: "hint" as const },
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({
        ...entry,
        assistance: "hint" as const,
      })),
    },
  };
  const queueObjective = { id: "queues", title: "Explain queues" };
  const graphObjective = { id: "graphs", title: "Traverse graphs" };
  const diagnostics = diagnoseLearningObjectives([queueObjective], [self, assisted], acceptedAt);
  assert.equal(diagnostics.at(0)?.status, "needs-attention");
  assert.equal(diagnostics.at(0)?.independentEvidenceCount, 0);
  assert.equal(diagnostics.at(0)?.assistedEvidenceCount, 1);
  assert.equal(diagnostics.at(0)?.selfReportedEvidenceCount, 1);
  assert.equal(diagnostics.at(0)?.recommendation, "targeted-practice");
  const noEvidence = diagnoseLearningObjectives([graphObjective], [], acceptedAt).at(0);
  assert.equal(noEvidence?.status, "no-evidence");
  assert.equal(noEvidence.recommendation, "targeted-practice");
  const lowScore = {
    ...attempt,
    result: {
      ...attempt.result,
      evidence: attempt.result.evidence.map((entry) => ({ ...entry, score: 0.2 })),
    },
  };
  const lowDiagnostics = diagnoseLearningObjectives([queueObjective], [lowScore], acceptedAt);
  assert.deepEqual(lowDiagnostics.at(0)?.lowConfidenceOrScoreDimensions, ["recognition"]);
  assert.equal(lowDiagnostics.at(0)?.status, "needs-attention");
  const improvedAttempt = {
    ...attempt,
    id: "improved",
    acceptedAt: "2026-10-14T09:02:00.000Z",
  };
  assert.equal(
    diagnoseLearningObjectives(
      [queueObjective],
      [lowScore, improvedAttempt],
      "2026-10-15T00:00:00.000Z",
    ).at(0)?.status,
    "developing",
  );
  const laterLowAttempt = {
    ...lowScore,
    id: "later-low",
    acceptedAt: "2026-10-14T10:02:00.000Z",
  };
  assert.equal(
    diagnoseLearningObjectives(
      [queueObjective],
      [improvedAttempt, laterLowAttempt],
      "2026-10-15T00:00:00.000Z",
    ).at(0)?.status,
    "needs-attention",
  );
  assert.equal(
    diagnoseLearningObjectives([queueObjective], [attempt], acceptedAt).at(0)?.status,
    "developing",
  );
  const staleAttempt = {
    ...attempt,
    acceptedAt: "2026-07-01T09:02:00.000Z",
  };
  const staleDiagnostic = diagnoseLearningObjectives(
    [queueObjective],
    [staleAttempt],
    "2026-10-15T00:00:00.000Z",
  ).at(0);
  assert.equal(staleDiagnostic?.status, "needs-attention");
  assert.equal(staleDiagnostic.recommendation, "targeted-practice");
  const futureDiagnostic = diagnoseLearningObjectives(
    [queueObjective],
    [{ ...lowScore, acceptedAt: "2026-10-16T09:02:00.000Z" }],
    "2026-10-15T00:00:00.000Z",
  ).at(0);
  assert.equal(futureDiagnostic?.status, "no-evidence");
  assert.equal(futureDiagnostic.independentEvidenceCount, 0);
  assert.equal(
    diagnoseLearningObjectives([queueObjective], [attempt], "invalid-now").at(0)?.status,
    "no-evidence",
  );
});
