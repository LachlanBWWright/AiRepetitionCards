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
import { createOpenAiProvider } from "@recall/infra-openai";

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
    Effect.either(
      executeTutorWorkflow(prepared.right, fakeProvider(envelope(quiz), []), proposalId),
    ),
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
      executeTutorWorkflow(quizPrepared.right, fakeProvider(envelope(evaluation), []), proposalId),
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
