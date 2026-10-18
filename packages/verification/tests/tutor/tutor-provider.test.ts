import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either, Schema } from "effect";
import {
  TutorContextSchema,
  type AiProviderCapabilities,
  type TutorContext,
} from "@recall/ai-core";
import {
  executeTutorWorkflow,
  prepareTutorWorkflow,
  resolveTutorWorkflowProposal,
  validateTutorProposalResolution,
  type TutorWorkflowProvider,
  type TutorWorkflowSnapshot,
} from "@recall/application";

const sessionId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const fixture = Effect.runSync(
  Effect.either(
    Schema.decodeUnknown(TutorContextSchema)({
      knowledgeArea: {
        schemaVersion: "1.0.0",
        id: "biology",
        title: "Biology",
        description: null,
        language: "en",
        objectives: [
          { id: "cells", title: "Explain cells", description: null, prerequisiteIds: [] },
        ],
        ai: {
          tutorInstructions: "Use retrieval practice.",
          quizInstructions: null,
          cardGenerationInstructions: null,
        },
        cards: [],
        tags: [],
        licence: null,
      },
      history: [],
    }),
  ),
);
assert.ok(Either.isRight(fixture));
const context: TutorContext = fixture.right;
const question = {
  question: "What does a cell membrane do?",
  objectiveId: "cells",
  teachingIntent: "Check recall.",
};
const evaluation = {
  result: "partial",
  confidence: 0.7,
  feedback: "It regulates transport.",
  misconception: null,
  objectiveId: "cells",
  suggestedAction: "propose-card",
} as const;
const proposal = {
  front: "What does a cell membrane do?",
  back: "Regulates transport.",
  objectiveId: "cells",
  rationale: "Address the gap.",
};
const capabilities: AiProviderCapabilities = {
  supportedOperations: ["question", "evaluate", "propose-card", "targeted-quiz"],
  structuredOutputs: true,
  streaming: false,
  maxInputBytes: 96_000,
  maxOutputTokens: 2600,
};
const envelope = (result: unknown, outputTokens: number | null = 20) => ({
  result,
  inputTokens: 50,
  outputTokens,
  model: "fixture-model",
});
function fakeProvider(
  result: unknown,
  calls: string[],
  declared = capabilities,
): TutorWorkflowProvider<never> {
  const invoke = (operation: string) => {
    calls.push(operation);
    return Effect.succeed(result);
  };
  return {
    capabilities: declared,
    generateQuestion: () => invoke("question"),
    evaluateAnswer: () => invoke("evaluate"),
    proposeCard: () => invoke("propose-card"),
    generateTargetedQuiz: () => invoke("targeted-quiz"),
  };
}
const snapshot = (): TutorWorkflowSnapshot => ({
  context,
  pendingQuestion: false,
  state: {
    sessionId,
    history: [],
    evaluation: null,
    observations: [],
    proposal: null,
    quiz: null,
  },
});
async function questionPrepared() {
  const result = await Effect.runPromise(
    Effect.either(prepareTutorWorkflow({ action: "question", context }, null, sessionId)),
  );
  assert.ok(Either.isRight(result));
  return result.right;
}
async function failureTag<A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>,
  tag: string,
) {
  const result = await Effect.runPromise(Effect.either(effect));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, tag);
  return result.left;
}

void test("workflow validates a question transition without mutating its input", async () => {
  const prepared = await questionPrepared();
  const before = JSON.stringify(prepared);
  const calls: string[] = [];
  const result = await Effect.runPromise(
    Effect.either(
      executeTutorWorkflow(prepared, fakeProvider(envelope(question), calls), proposalId),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(calls, ["question"]);
  assert.equal(result.right.snapshot.pendingQuestion, true);
  assert.equal(result.right.snapshot.state.proposal, null);
  assert.deepEqual(result.right.appendedHistory, [
    { role: "assistant", content: question.question },
  ]);
  assert.equal(JSON.stringify(prepared), before);
});

void test("unsupported, unstructured and invalid capability providers never run", async () => {
  const prepared = await questionPrepared();
  for (const [declared, code] of [
    [{ ...capabilities, supportedOperations: ["evaluate"] }, "unsupported-operation"],
    [{ ...capabilities, structuredOutputs: false }, "structured-output-unsupported"],
    [{ ...capabilities, maxInputBytes: -1 }, "invalid-provider-capabilities"],
  ] as const) {
    const calls: string[] = [];
    const error = await failureTag(
      executeTutorWorkflow(prepared, fakeProvider(envelope(question), calls, declared), proposalId),
      "TutorWorkflowFailure",
    );
    assert.ok(error._tag === "TutorWorkflowFailure");
    assert.equal(error.code, code);
    assert.deepEqual(calls, []);
  }
});

void test("declared input bound rejects before invocation", async () => {
  const calls: string[] = [];
  await failureTag(
    executeTutorWorkflow(
      await questionPrepared(),
      fakeProvider(envelope(question), calls, { ...capabilities, maxInputBytes: 1 }),
      proposalId,
    ),
    "AiContextBudgetExceeded",
  );
  assert.deepEqual(calls, []);
});

void test("output overrun is metered before rejection and unknown usage has no invented token estimate", async () => {
  const prepared = await questionPrepared();
  const recorded: number[] = [];
  const error = await failureTag(
    executeTutorWorkflow(
      prepared,
      fakeProvider(envelope(question, 2601), []),
      proposalId,
      (usage) =>
        Effect.sync(() => {
          recorded.push(usage.outputTokens ?? -1);
        }),
    ),
    "TutorWorkflowFailure",
  );
  assert.ok(error._tag === "TutorWorkflowFailure");
  assert.equal(error.code, "output-budget-exceeded");
  assert.deepEqual(recorded, [2601]);
  const unknown = await Effect.runPromise(
    Effect.either(
      executeTutorWorkflow(prepared, fakeProvider(envelope(question, null), []), proposalId),
    ),
  );
  assert.ok(Either.isRight(unknown));
  assert.equal(unknown.right.metering.outputTokens, null);
});

void test("arbitrary unknown outputs cannot become question transitions", async () => {
  const prepared = await questionPrepared();
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.boolean(), fc.integer(), fc.string(), fc.array(fc.jsonValue())),
      async (value) => {
        const result = await Effect.runPromise(
          Effect.either(
            executeTutorWorkflow(prepared, fakeProvider(envelope(value), []), proposalId),
          ),
        );
        assert.ok(Either.isLeft(result));
        assert.ok(result.left._tag === "TutorWorkflowFailure");
        assert.equal(result.left.code, "invalid-provider-response");
      },
    ),
    { numRuns: 40, seed: 20261003 },
  );
});

void test("feedback cannot be evaluated as a new unanswered question", async () => {
  const current = snapshot();
  const error = await failureTag(
    prepareTutorWorkflow(
      { action: "evaluate", sessionId, answer: "Transport." },
      {
        ...current,
        state: {
          ...current.state,
          history: [{ role: "assistant", content: evaluation.feedback }],
          evaluation,
        },
      },
      sessionId,
    ),
    "TutorWorkflowFailure",
  );
  assert.equal(error.code, "question-required");
});

void test("proposal eligibility and approval remain separate transitions", async () => {
  const current = snapshot();
  const blocked = await failureTag(
    prepareTutorWorkflow({ action: "propose-card", sessionId }, current, sessionId),
    "TutorWorkflowFailure",
  );
  assert.equal(blocked.code, "observation-not-found");
  const prepared = await Effect.runPromise(
    Effect.either(
      prepareTutorWorkflow(
        { action: "propose-card", sessionId },
        {
          ...current,
          state: { ...current.state, evaluation },
        },
        sessionId,
      ),
    ),
  );
  assert.ok(Either.isRight(prepared));
  const result = await Effect.runPromise(
    Effect.either(
      executeTutorWorkflow(prepared.right, fakeProvider(envelope(proposal), []), proposalId),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(result.right.snapshot.state.proposal, { proposalId, content: proposal });
  assert.deepEqual(result.right.appendedHistory, []);
  const invalid = await failureTag(
    validateTutorProposalResolution({
      proposalId,
      state: "approved",
      cardId: sessionId,
      content: proposal,
    }),
    "TutorWorkflowFailure",
  );
  assert.equal(invalid.code, "invalid-request");
  const approved = await Effect.runPromise(
    Effect.either(
      resolveTutorWorkflowProposal(result.right.snapshot, {
        proposalId,
        state: "approved",
        cardId: proposalId,
        content: proposal,
      }),
    ),
  );
  assert.ok(Either.isRight(approved));
  assert.equal(approved.right.state.proposal, null);
  assert.deepEqual(approved.right.state.evaluation, evaluation);
});

void test("workflow rejects foreign objective output and area mismatch", async () => {
  const error = await failureTag(
    executeTutorWorkflow(
      await questionPrepared(),
      fakeProvider(envelope({ ...question, objectiveId: "unknown" }), []),
      proposalId,
    ),
    "TutorWorkflowFailure",
  );
  assert.ok(error._tag === "TutorWorkflowFailure");
  assert.equal(error.code, "invalid-provider-response");
  const mismatch = await failureTag(
    prepareTutorWorkflow(
      {
        action: "question",
        sessionId,
        context: {
          ...context,
          knowledgeArea: { ...context.knowledgeArea, id: "another-area" },
        },
      },
      snapshot(),
      sessionId,
    ),
    "TutorWorkflowFailure",
  );
  assert.equal(mismatch.code, "session-area-mismatch");
});
