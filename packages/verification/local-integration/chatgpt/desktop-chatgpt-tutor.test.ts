import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  IMPROVEMENT_CHAT_INSTRUCTIONS,
  TUTOR_QUESTION_INSTRUCTIONS,
  type TutorTokenUsage,
} from "@recall/ai-core";
import { sendImprovementMessage } from "@recall/application";
import { Request } from "../../../../apps/desktop/src/main/chatgpt/transport/chatgpt-local-protocol.js";
import { createAreaId, createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { createLocalChatGptTutor } from "../../../../apps/web/src/lib/chatgpt-local-tutor.js";

const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("test-cells"),
  title: "Cells",
  description: "Study cell energy.",
  language: "en",
  objectives: [],
  cards: [],
  tags: [],
  licence: null,
  ai: {
    tutorInstructions: "Use short explanations.",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
};
function inferenceReply(value: unknown) {
  return {
    _tag: "Success",
    value: {
      text: JSON.stringify(value),
      usage: {
        model: "study-model",
        inputTokens: 1200,
        outputTokens: 40,
        cachedInputTokens: null,
        cacheWriteTokens: null,
      },
    },
  };
}
const HttpFailure = Schema.Struct({ reason: Schema.Literal("http"), code: Schema.String });
const Inference = Schema.Struct({
  instructions: Schema.String,
  input: Schema.String,
  model: Schema.String,
  expectedClientId: Schema.String,
});

async function withDesktop<A>(
  respond: (input: unknown) => Promise<unknown>,
  run: () => Promise<A>,
) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      recallDesktop: {
        chatgpt: {
          status: () =>
            Promise.resolve({ _tag: "Success", value: { activeClientId: "test-client" } }),
          respond,
        },
      },
      dispatchEvent: () => true,
    },
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

await test("the real local tutor workflow sends trusted instructions separately and accepts validated JSON", async () => {
  let captured: unknown = null;
  const usage: TutorTokenUsage[] = [];
  await withDesktop(
    (input) => {
      captured = input;
      return Promise.resolve(
        inferenceReply({
          question: "Why do cells need ATP?",
          objectiveId: null,
          teachingIntent: "Retrieve the role of ATP.",
        }),
      );
    },
    async () => {
      const api = createLocalChatGptTutor("test-client", "study-model", area.id, (next) => {
        usage.push(next);
      });
      const result = await Effect.runPromise(
        api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
      );
      assert.equal(result.action, "question");
      assert.equal(result.result.question, "Why do cells need ATP?");
    },
  );
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.inputTokens, 1200);
  const inference = await Effect.runPromise(Schema.decodeUnknown(Inference)(captured));
  assert.match(inference.instructions, /untrusted learning data/);
  assert.match(inference.instructions, /Return only JSON/);
  assert.ok(inference.instructions.includes(TUTOR_QUESTION_INSTRUCTIONS));
  assert.equal(inference.expectedClientId, "test-client");
  const payload = await Effect.runPromise(
    Schema.decodeUnknown(
      Schema.parseJson(Schema.Struct({ schema: Schema.Unknown, data: Schema.Unknown })),
    )(inference.input),
  );
  assert.equal("instructions" in payload, false);
});

await test("invalid objective output fails validation without blaming the connection or saving a session", async () => {
  await withDesktop(
    () =>
      Promise.resolve(
        inferenceReply({
          question: "Why ATP?",
          objectiveId: "invented-objective",
          teachingIntent: "Recall.",
        }),
      ),
    async () => {
      const api = createLocalChatGptTutor("test-client", "study-model", area.id);
      const result = await Effect.runPromise(
        Effect.either(
          api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
        ),
      );
      assert.equal(Either.isLeft(result), true);
      if (Either.isLeft(result)) {
        const failure = await Effect.runPromise(Schema.decodeUnknown(HttpFailure)(result.left));
        assert.match(failure.code, /did not match the requested study task/);
        assert.doesNotMatch(failure.code, /connection|temporarily unavailable/);
      }
    },
  );
});

await test("main-process timeout is preserved through the tutor application adapter", async () => {
  await withDesktop(
    () => Promise.resolve({ _tag: "Failure", code: "request-timeout" }),
    async () => {
      const api = createLocalChatGptTutor("test-client", "study-model", area.id);
      const result = await Effect.runPromise(
        Effect.either(
          api.request({ action: "question", context: { knowledgeArea: area, history: [] } }),
        ),
      );
      assert.equal(Either.isLeft(result), true);
      if (Either.isLeft(result)) {
        const failure = await Effect.runPromise(Schema.decodeUnknown(HttpFailure)(result.left));
        assert.match(failure.code, /took too long/);
      }
    },
  );
});

await test("Improve's first message passes the real local workflow and desktop inference boundary", async () => {
  let calls = 0;
  await withDesktop(
    (input) => {
      const decoded = Schema.decodeUnknownEither(Request)(input);
      assert.ok(Either.isRight(decoded), "Desktop must accept the generated inference request");
      assert.ok(decoded.right.instructions, "Improvement requests must include instructions");
      assert.ok(decoded.right.instructions.includes(IMPROVEMENT_CHAT_INSTRUCTIONS));
      calls += 1;
      return Promise.resolve(
        inferenceReply({
          question: "How does ATP connect energy release and cellular work?",
          objectiveId: null,
          teachingIntent: "Explore the connection.",
        }),
      );
    },
    async () => {
      const api = createLocalChatGptTutor("test-client", "study-model", area.id);
      const result = await Effect.runPromise(
        sendImprovementMessage(
          { notebook: null, area, reviews: [], message: "Find gaps in my understanding" },
          {
            api,
            save: (next) => Effect.succeed(next),
            now: () => 1000,
            createId: () => crypto.randomUUID(),
          },
        ),
      );
      assert.equal(result.session.pendingQuestion, null);
      assert.equal(result.improvementChat?.length, 3);
      assert.deepEqual(
        result.improvementChat.map((message) => message.role),
        ["assistant", "learner", "assistant"],
      );
      assert.equal(result.evidence.length, 0);
    },
  );
  assert.equal(calls, 1);
});

await test("Improve with no selected model stops before the desktop boundary and gives model recovery", async () => {
  let calls = 0;
  await withDesktop(
    (input) => {
      calls += 1;
      const decoded = Schema.decodeUnknownEither(Request)(input);
      return Promise.resolve(
        Either.isLeft(decoded)
          ? { _tag: "Failure", code: "invalid-request" }
          : { _tag: "Failure", code: "unexpected-inference" },
      );
    },
    async () => {
      const api = createLocalChatGptTutor("test-client", "", area.id);
      const result = await Effect.runPromise(
        Effect.either(
          sendImprovementMessage(
            { notebook: null, area, reviews: [], message: "Improve this subject" },
            {
              api,
              save: (next) => Effect.succeed(next),
              now: () => 1000,
              createId: () => crypto.randomUUID(),
            },
          ),
        ),
      );
      assert.ok(Either.isLeft(result));
      assert.match(result.left.message, /choose.*model/i);
      assert.doesNotMatch(result.left.message, /OpenAI rejected/);
    },
  );
  assert.equal(calls, 0);
});

await test("invalid local tutor context is distinguished from a provider rejection", async () => {
  let calls = 0;
  await withDesktop(
    () => {
      calls += 1;
      return Promise.resolve({ _tag: "Failure", code: "unexpected-inference" });
    },
    async () => {
      const api = createLocalChatGptTutor("test-client", "study-model", area.id);
      const duplicate = {
        id: createObjectiveId("same-id"),
        title: "Energy",
        description: null,
        prerequisiteIds: [],
      };
      const result = await Effect.runPromise(
        Effect.either(
          api.request({
            action: "question",
            context: {
              knowledgeArea: { ...area, objectives: [duplicate, duplicate] },
              history: [],
            },
          }),
        ),
      );
      assert.ok(Either.isLeft(result));
      const failure = await Effect.runPromise(Schema.decodeUnknown(HttpFailure)(result.left));
      assert.match(failure.code, /before sending/);
      assert.doesNotMatch(failure.code, /OpenAI rejected/);
    },
  );
  assert.equal(calls, 0);
});
