import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  beginNotebookSession,
  createKnowledgeNotebookTutor,
  KnowledgeNotebookSchema,
  updateNotebookGoal,
  type KnowledgeNotebook,
} from "@recall/application";
import { conceptId, knowledgeArea, searchFixture, uuid } from "../fixtures/search-workspace";

function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("changing the goal preserves the active question, draft, history and source material across reload", () => {
  const seeded = searchFixture().notebook;
  const started = success(
    beginNotebookSession(seeded, {
      startedAt: 1000,
      maxQuestions: 12,
      maxRequests: 40,
      maximumDurationMs: 60000,
    }),
  );
  const notebook: KnowledgeNotebook = {
    ...started,
    session: {
      ...started.session,
      targetConceptId: conceptId,
      pendingQuestion: {
        question: "Why use channels?",
        objectiveId: conceptId,
        teachingIntent: "Recall concurrency.",
      },
      providerSessionId: uuid(20),
      draftAnswer: "Channels coordinate…",
      draftConfidence: "confident",
      askedQuestions: 2,
      requestsUsed: 3,
    },
  };
  const snapshot = JSON.stringify(notebook);
  const updated = success(updateNotebookGoal(notebook, "  Explain channel synchronization  "));
  assert.equal(updated.goal, "Explain channel synchronization");
  assert.deepEqual({ ...updated, goal: notebook.goal }, notebook);
  assert.equal(JSON.stringify(notebook), snapshot);
  const restored = success(
    Schema.decodeUnknown(Schema.parseJson(KnowledgeNotebookSchema))(JSON.stringify(updated)),
  );
  assert.deepEqual(restored, updated);
});

void test("goals can change before practice and the next tutor question receives the new goal", async () => {
  const original = searchFixture().notebook;
  const updated = success(updateNotebookGoal(original, "Understand channel synchronization"));
  assert.equal(updated.session.phase, "idle");
  const started = success(
    beginNotebookSession(updated, {
      startedAt: 1000,
      maxQuestions: 12,
      maxRequests: 40,
      maximumDurationMs: 60000,
    }),
  );
  let requestedGoal: string | undefined;
  const tutor = createKnowledgeNotebookTutor(
    {
      request: (request) => {
        if (request.action === "question") requestedGoal = request.context.investigation?.goal;
        return Effect.succeed({
          action: "question",
          sessionId: uuid(21),
          result: {
            question: "How do channels synchronize goroutines?",
            objectiveId: conceptId,
            teachingIntent: "Apply synchronization.",
          },
        });
      },
    },
    () => Effect.void,
  );
  const asked = await Effect.runPromise(
    tutor.ask(started, { knowledgeArea: knowledgeArea(), history: [] }, 1001),
  );
  assert.equal(requestedGoal, updated.goal);
  assert.equal(asked.goal, updated.goal);
  assert.ok(asked.session.pendingQuestion);
  assert.deepEqual(asked.materials, original.materials);
  assert.deepEqual(asked.evidence, original.evidence);
});

void test("invalid goal edits fail without changing the saved notebook", () => {
  const notebook = searchFixture().notebook;
  const snapshot = JSON.stringify(notebook);
  for (const input of ["", " \n ", "a".repeat(2001), null, 42, { goal: "Study" }]) {
    const result = Effect.runSync(Effect.either(updateNotebookGoal(notebook, input)));
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, "invalid-input");
    assert.equal(JSON.stringify(notebook), snapshot);
  }
});
