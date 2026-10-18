import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { TutorContextSchema, type TutorContext } from "@recall/ai-core";
import {
  executeTutorWorkflow,
  prepareTutorWorkflow,
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
const capabilities = {
  supportedOperations: ["question", "evaluate", "propose-card", "targeted-quiz"] as const,
  structuredOutputs: true,
  streaming: false,
  maxInputBytes: 96_000,
  maxOutputTokens: 2600,
};
const envelope = (result: unknown) => ({
  result,
  inputTokens: 50,
  outputTokens: 20,
  model: "fixture-model",
});
function fakeProvider(result: unknown): TutorWorkflowProvider<never> {
  const invoke = () => Effect.succeed(result);
  return {
    capabilities,
    generateQuestion: invoke,
    evaluateAnswer: invoke,
    proposeCard: invoke,
    generateTargetedQuiz: invoke,
  };
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
const snapshot = (): TutorWorkflowSnapshot => ({
  context,
  pendingQuestion: false,
  state: { sessionId, history: [], evaluation: null, observations: [], proposal: null, quiz: null },
});

void test("invalid request/session boundaries reject before a provider exists", async () => {
  for (const input of [
    null,
    {},
    { action: "question" },
    { action: "evaluate", sessionId: "bad-id", answer: "a" },
  ]) {
    const result = await failureTag(
      prepareTutorWorkflow(input, null, sessionId),
      "TutorWorkflowFailure",
    );
    assert.equal(result.code, "invalid-request");
  }
  const missing = await failureTag(
    prepareTutorWorkflow({ action: "evaluate", sessionId, answer: "a" }, null, sessionId),
    "TutorWorkflowFailure",
  );
  assert.equal(missing.code, "session-not-found");
  const wrongSession = await failureTag(
    prepareTutorWorkflow(
      { action: "question", sessionId, context },
      { ...snapshot(), state: { ...snapshot().state, sessionId: proposalId } },
      sessionId,
    ),
    "TutorWorkflowFailure",
  );
  assert.equal(wrongSession.code, "invalid-session");
});

void test("targeted quizzes clear stale proposals and only unanswered quiz questions can be evaluated", async () => {
  const previous = snapshot();
  const quiz = {
    objectiveId: "cells",
    objectiveTitle: "Model title",
    questions: [
      { prompt: "What is a cell?", expectedAnswer: "A living unit." },
      { prompt: "What does the membrane do?", expectedAnswer: "Regulates transport." },
    ],
  };
  const prepared = await Effect.runPromise(
    Effect.either(
      prepareTutorWorkflow(
        { action: "targeted-quiz", sessionId, objectiveId: "cells" },
        {
          ...previous,
          state: { ...previous.state, evaluation, proposal: { proposalId, content: proposal } },
        },
        sessionId,
      ),
    ),
  );
  assert.ok(Either.isRight(prepared));
  const created = await Effect.runPromise(
    Effect.either(executeTutorWorkflow(prepared.right, fakeProvider(envelope(quiz)), proposalId)),
  );
  assert.ok(Either.isRight(created));
  assert.equal(created.right.snapshot.state.proposal, null);
  assert.equal(created.right.snapshot.state.evaluation, null);
  assert.equal(created.right.snapshot.state.quiz?.objectiveTitle, "Explain cells");
  const quizPrepared = await Effect.runPromise(
    Effect.either(
      prepareTutorWorkflow(
        { action: "evaluate-quiz-answer", sessionId, questionIndex: 0, answer: "A living unit." },
        created.right.snapshot,
        sessionId,
      ),
    ),
  );
  assert.ok(Either.isRight(quizPrepared));
  const answered = await Effect.runPromise(
    Effect.either(
      executeTutorWorkflow(quizPrepared.right, fakeProvider(envelope(evaluation)), proposalId),
    ),
  );
  assert.ok(Either.isRight(answered));
  assert.deepEqual(answered.right.snapshot.state.quiz?.questions[0]?.evaluation, evaluation);
  assert.equal(answered.right.snapshot.state.quiz.questions[1]?.evaluation, null);
  const duplicate = await failureTag(
    prepareTutorWorkflow(
      { action: "evaluate-quiz-answer", sessionId, questionIndex: 0, answer: "Again." },
      answered.right.snapshot,
      sessionId,
    ),
    "TutorWorkflowFailure",
  );
  assert.equal(duplicate.code, "quiz-answer-already-evaluated");
});
