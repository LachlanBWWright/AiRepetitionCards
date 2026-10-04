import { Effect, Either, Schema } from "effect";
import { chatGptPlanFailureMessage } from "./chatgpt-plan-errors";
import "./desktop-api";

export const ChatGPTResearchResultSchema = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100000)),
  citations: Schema.Array(
    Schema.Struct({
      url: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2048)),
      title: Schema.String.pipe(Schema.maxLength(1000)),
      startIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      endIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    }),
  ).pipe(Schema.maxItems(100)),
  searched: Schema.Boolean,
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
});
export type ChatGPTResearchResult = typeof ChatGPTResearchResultSchema.Type;
export type ChatGPTResearchFailure = {
  readonly _tag: "ChatGPTResearchFailure";
  readonly message: string;
};
const Reply = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Unknown }),
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    code: Schema.String,
    status: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(100, 599))),
    recovery: Schema.optional(Schema.String),
  }),
);
const failure = (message: string): ChatGPTResearchFailure => ({
  _tag: "ChatGPTResearchFailure",
  message,
});
export function safeResearchUrl(input: string): string | null {
  const parsed = Effect.runSync(
    Effect.either(Effect.try({ try: () => new URL(input), catch: () => null })),
  );
  if (Either.isLeft(parsed)) return null;
  const url = parsed.right;
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : null;
}
function researchFailureMessage(input: typeof Reply.Type & { readonly _tag: "Failure" }) {
  if (input.code === "research-not-searched")
    return "The selected model did not perform a web search. Try another available model or a clearer query.";
  if (input.code === "research-no-citations")
    return "The search returned no source citations. Try another query; the previous result remains available.";
  if (input.code === "invalid-research-response")
    return "The search response could not be validated. Try again; the previous result remains available.";
  if (input.recovery === "unsupported")
    return "Web search is unavailable for this model, account or workspace. Choose another available model or check workspace permissions.";
  if (input.code === "inference-in-progress")
    return "Another ChatGPT request is running. Wait for it to finish before searching again.";
  return chatGptPlanFailureMessage({
    code: input.code,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.recovery === undefined ? {} : { recovery: input.recovery }),
  });
}
export function decodeChatGPTResearchResult(
  input: unknown,
  model: string,
): Effect.Effect<ChatGPTResearchResult, ChatGPTResearchFailure> {
  return Schema.decodeUnknown(ChatGPTResearchResultSchema)(input).pipe(
    Effect.mapError(() => failure("The search response could not be validated.")),
    Effect.flatMap((result) => {
      if (
        result.model !== model ||
        result.citations.some(
          (citation) =>
            !Number.isSafeInteger(citation.startIndex) ||
            !Number.isSafeInteger(citation.endIndex) ||
            citation.startIndex > citation.endIndex ||
            citation.endIndex > result.text.length ||
            safeResearchUrl(citation.url) === null,
        )
      )
        return Effect.fail(failure("The search response contains invalid source references."));
      if (!result.searched)
        return Effect.fail(
          failure("The selected model did not perform a web search. Try another available model."),
        );
      if (result.citations.length === 0)
        return Effect.fail(failure("The search returned no source citations. Try another query."));
      return Effect.succeed(result);
    }),
  );
}
export type ChatGPTResearchInput = {
  readonly query: string;
  readonly model: string;
  readonly expectedClientId: string;
};
export type ChatGPTResearchApi = {
  readonly search: (
    input: ChatGPTResearchInput,
  ) => Effect.Effect<ChatGPTResearchResult, ChatGPTResearchFailure>;
  readonly openSource: (
    url: string,
    expectedClientId: string,
  ) => Effect.Effect<void, ChatGPTResearchFailure>;
};
export const chatGPTResearchApi: ChatGPTResearchApi = {
  search: (input) =>
    Effect.gen(function* () {
      if (
        !input.query.trim() ||
        input.query.length > 2000 ||
        !input.model ||
        !input.expectedClientId
      )
        return yield* Effect.fail(
          failure(
            "Enter a query of up to 2,000 characters and select your ChatGPT account and model.",
          ),
        );
      const bridge = window.recallDesktop?.chatgpt;
      if (!bridge)
        return yield* Effect.fail(
          failure("Connect your ChatGPT account in the desktop app to search."),
        );
      const raw = yield* Effect.tryPromise({
        try: () => bridge.research(input),
        catch: () => failure("The search could not complete. Check your connection and try again."),
      });
      const reply = yield* Schema.decodeUnknown(Reply)(raw).pipe(
        Effect.mapError(() => failure("The search response could not be validated.")),
      );
      if (reply._tag === "Failure") {
        window.dispatchEvent(new Event("recall-chatgpt-plan-state-changed"));
        return yield* Effect.fail(failure(researchFailureMessage(reply)));
      }
      return yield* decodeChatGPTResearchResult(reply.value, input.model);
    }),
  openSource: (url, expectedClientId) =>
    Effect.gen(function* () {
      const bridge = window.recallDesktop?.chatgpt;
      if (!bridge || safeResearchUrl(url) === null)
        return yield* Effect.fail(
          failure("This source could not be opened. Copy its address and open it in your browser."),
        );
      const raw = yield* Effect.tryPromise({
        try: () => bridge.openResearchSource({ url, expectedClientId }),
        catch: () =>
          failure("This source could not be opened. Copy its address and open it in your browser."),
      });
      const opened = Schema.decodeUnknownEither(
        Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Literal(true) }),
      )(raw);
      if (Either.isLeft(opened))
        return yield* Effect.fail(
          failure("This source could not be opened. Copy its address and open it in your browser."),
        );
    }),
};
