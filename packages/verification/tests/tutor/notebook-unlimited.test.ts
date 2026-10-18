import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  KnowledgeNotebookSchema,
  reserveNotebookRequest,
  selectNotebookTarget,
  setNotebookQuestion,
} from "@recall/application";
import { conceptId, searchFixture } from "../fixtures/search-workspace";

void test("legacy time, question and request caps cannot block a saved active session", () => {
  const original = searchFixture().notebook;
  const notebook = Effect.runSync(
    Schema.decodeUnknown(KnowledgeNotebookSchema)({
      ...original,
      session: {
        ...original.session,
        phase: "active",
        startedAt: 1000,
        maxQuestions: 12,
        maxRequests: 40,
        maximumDurationMs: 60000,
        askedQuestions: 1000,
        requestsUsed: 5000,
      },
    }),
  );
  assert.equal("maxQuestions" in notebook.session, false);
  assert.equal("maxRequests" in notebook.session, false);
  assert.equal("maximumDurationMs" in notebook.session, false);
  const now = 1000 + 24 * 60 * 60 * 1000;
  const target = Effect.runSync(selectNotebookTarget(notebook, now));
  assert.ok(target);
  const reserved = Effect.runSync(reserveNotebookRequest(notebook, now));
  assert.equal(reserved.session.requestsUsed, 5001);
  const asked = Effect.runSync(
    setNotebookQuestion(reserved, {
      conceptId,
      now,
      question: {
        question: "How do channels synchronize work?",
        objectiveId: conceptId,
        teachingIntent: "Apply concurrency.",
      },
    }),
  );
  assert.equal(asked.session.askedQuestions, 1001);
  assert.deepEqual(asked.evidence, original.evidence);
  assert.deepEqual(asked.proposals, original.proposals);
  assert.deepEqual(asked.materials, original.materials);
  const evaluated = Effect.runSync(reserveNotebookRequest(asked, now, "evaluate"));
  assert.equal(evaluated.session.requestsUsed, 5002);
});

void test("removing local caps preserves explicit session and pending-question validation", () => {
  const idle = searchFixture().notebook;
  const result = Effect.runSync(Effect.either(reserveNotebookRequest(idle, 1000)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "session-inactive");
});
