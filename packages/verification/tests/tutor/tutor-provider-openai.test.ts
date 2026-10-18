import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  TutorContextSchema,
  TUTOR_QUESTION_INSTRUCTIONS,
  type TutorContext,
} from "@recall/ai-core";
import { createOpenAiProvider } from "@recall/infra-openai";

const contextResult = Effect.runSync(
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
assert.ok(Either.isRight(contextResult));
const context: TutorContext = contextResult.right;
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
async function failureTag<A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>,
  tag: string,
) {
  const result = await Effect.runPromise(Effect.either(effect));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, tag);
  return result.left;
}
function wireReply(text: string, usage: unknown = { input_tokens: 50, output_tokens: 20 }) {
  return {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage,
  };
}
function providerWithReply(
  body: unknown,
  status = 200,
  hooks: {
    readonly onRequestPrepared?: NonNullable<
      Parameters<typeof createOpenAiProvider>[0]["onRequestPrepared"]
    >;
    readonly onUsageRecorded?: NonNullable<
      Parameters<typeof createOpenAiProvider>[0]["onUsageRecorded"]
    >;
  } = {},
) {
  const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
  const mockFetch: typeof fetch = (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return Promise.resolve(Response.json(body, { status }));
  };
  return {
    calls,
    provider: createOpenAiProvider({
      apiKey: "fixture-key",
      model: "fixture-model",
      fetch: mockFetch,
      ...hooks,
    }),
  };
}

void test("provider sends the exact bounded Responses wire contract", async () => {
  const prepared: {
    readonly requestBytes: number;
    readonly maxOutputTokens: number;
    readonly operation: string;
    readonly model: string;
  }[] = [];
  const metered: { readonly inputTokens: number | null; readonly outputTokens: number | null }[] =
    [];
  const { provider, calls } = providerWithReply(wireReply(JSON.stringify(question)), 200, {
    onRequestPrepared: (request) =>
      Effect.sync(() => {
        prepared.push(request);
      }),
    onUsageRecorded: (usage) =>
      Effect.sync(() => {
        metered.push(usage);
      }),
  });
  const result = await Effect.runPromise(Effect.either(provider.generateQuestion(context)));
  assert.ok(Either.isRight(result));
  assert.deepEqual(result.right.result, question);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  const init = call.init;
  assert.ok(init);
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    authorization: "Bearer fixture-key",
    "content-type": "application/json",
  });
  assert.ok(init.signal instanceof AbortSignal);
  const body = init.body;
  assert.equal(typeof body, "string");
  assert.ok(typeof body === "string");
  const rawBody: unknown = JSON.parse(body);
  assert.ok(typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody));
  assert.deepEqual(
    Object.keys(rawBody).sort(),
    ["model", "store", "max_output_tokens", "instructions", "input", "text"].sort(),
  );
  const decoded = Schema.decodeUnknownEither(
    Schema.Struct({
      model: Schema.String,
      store: Schema.Boolean,
      max_output_tokens: Schema.Number,
      instructions: Schema.String,
      input: Schema.String,
      text: Schema.Struct({
        format: Schema.Struct({
          type: Schema.String,
          name: Schema.String,
          strict: Schema.Boolean,
          schema: Schema.Unknown,
        }),
      }),
    }),
  )(rawBody);
  assert.ok(Either.isRight(decoded));
  assert.equal(decoded.right.model, "fixture-model");
  assert.equal(decoded.right.store, false);
  assert.equal(decoded.right.max_output_tokens, 1200);
  assert.equal(decoded.right.input, JSON.stringify(context));
  assert.match(decoded.right.instructions, /untrusted data/);
  assert.ok(decoded.right.instructions.includes(TUTOR_QUESTION_INSTRUCTIONS));
  assert.deepEqual(
    {
      type: decoded.right.text.format.type,
      name: decoded.right.text.format.name,
      strict: decoded.right.text.format.strict,
    },
    { type: "json_schema", name: "question", strict: true },
  );
  assert.deepEqual(prepared, [
    {
      operation: "question",
      model: "fixture-model",
      requestBytes: new TextEncoder().encode(body).byteLength,
      maxOutputTokens: 1200,
    },
  ]);
  assert.deepEqual(metered, [{ inputTokens: 50, outputTokens: 20 }]);
});

void test("provider failures classify refusal, malformed JSON, foreign objectives and status errors", async () => {
  const cases: readonly {
    readonly body: unknown;
    readonly status: number;
    readonly tag: string;
  }[] = [
    {
      body: { output: [{ content: [{ type: "refusal", refusal: "No." }] }] },
      status: 200,
      tag: "AiRefusal",
    },
    { body: wireReply("not-json"), status: 200, tag: "AiStructuredOutputError" },
    {
      body: wireReply(JSON.stringify({ ...question, objectiveId: "unknown" })),
      status: 200,
      tag: "AiStructuredOutputError",
    },
    {
      body: { ...wireReply(JSON.stringify(question)), status: "incomplete" },
      status: 200,
      tag: "AiStructuredOutputError",
    },
    { body: {}, status: 429, tag: "AiRateLimited" },
    { body: { error: { code: "insufficient_quota" } }, status: 429, tag: "AiProviderUnavailable" },
    { body: {}, status: 500, tag: "AiProviderUnavailable" },
  ];
  for (const item of cases)
    await failureTag(
      providerWithReply(item.body, item.status).provider.generateQuestion(context),
      item.tag,
    );
});

void test("admission failure prevents network and reply failures still report usage first", async () => {
  const denied = providerWithReply(wireReply(JSON.stringify(question)), 200, {
    onRequestPrepared: () => Effect.fail({ _tag: "AiBudgetExceeded" } as const),
  });
  await failureTag(denied.provider.generateQuestion(context), "AiBudgetExceeded");
  assert.equal(denied.calls.length, 0);
  const recorded: unknown[] = [];
  const malformed = providerWithReply(wireReply("not-json"), 200, {
    onUsageRecorded: (usage) =>
      Effect.sync(() => {
        recorded.push(usage);
      }),
  });
  await failureTag(malformed.provider.generateQuestion(context), "AiStructuredOutputError");
  assert.deepEqual(recorded, [{ inputTokens: 50, outputTokens: 20 }]);
  const settlementFailure = providerWithReply(wireReply(JSON.stringify(question)), 200, {
    onUsageRecorded: () => Effect.fail({ _tag: "AiBudgetUnavailable" } as const),
  });
  await failureTag(settlementFailure.provider.generateQuestion(context), "AiBudgetUnavailable");
});

void test("invalid token usage stays unknown and provider network rejection is classified", async () => {
  const recorded: unknown[] = [];
  const response = providerWithReply(
    wireReply(JSON.stringify(question), { input_tokens: -1, output_tokens: "20" }),
    200,
    {
      onUsageRecorded: (usage) =>
        Effect.sync(() => {
          recorded.push(usage);
        }),
    },
  );
  const result = await Effect.runPromise(
    Effect.either(response.provider.generateQuestion(context)),
  );
  assert.ok(Either.isRight(result));
  assert.equal(result.right.inputTokens, null);
  assert.equal(result.right.outputTokens, null);
  assert.deepEqual(recorded, [{ inputTokens: null, outputTokens: null }]);
  const rejectedFetch: typeof fetch = () => Promise.reject(new Error("fixture transport failure"));
  await failureTag(
    createOpenAiProvider({
      apiKey: "fixture-key",
      model: "fixture-model",
      fetch: rejectedFetch,
    }).generateQuestion(context),
    "AiProviderUnavailable",
  );
});

void test("provider model routing and missing credentials never silently invoke another task", async () => {
  const calls: unknown[] = [];
  const mockFetch: typeof fetch = (_input, init) => {
    calls.push(init?.body);
    return Promise.resolve(Response.json(wireReply(JSON.stringify(evaluation))));
  };
  const provider = createOpenAiProvider({
    apiKey: "fixture-key",
    model: "default-model",
    taskModels: { evaluation: "evaluation-model" },
    fetch: mockFetch,
  });
  const result = await Effect.runPromise(
    Effect.either(provider.evaluateAnswer({ ...context, answer: "Transport." })),
  );
  assert.ok(Either.isRight(result));
  assert.equal(result.right.model, "evaluation-model");
  const requestBody = calls[0];
  assert.ok(typeof requestBody === "string");
  const decoded = Schema.decodeUnknownEither(
    Schema.Struct({ model: Schema.String, max_output_tokens: Schema.Number }),
  )(JSON.parse(requestBody) as unknown);
  assert.ok(Either.isRight(decoded));
  assert.equal(decoded.right.model, "evaluation-model");
  assert.equal(decoded.right.max_output_tokens, 1800);
  await failureTag(
    createOpenAiProvider({
      apiKey: undefined,
      model: "default-model",
      fetch: mockFetch,
    }).generateQuestion(context),
    "AiProviderUnavailable",
  );
  await failureTag(
    createOpenAiProvider({
      apiKey: "fixture-key",
      model: "default-model",
      taskModels: { evaluation: " invalid " },
      fetch: mockFetch,
    }).evaluateAnswer({ ...context, answer: "a" }),
    "AiProviderUnavailable",
  );
  assert.equal(calls.length, 1);
});
