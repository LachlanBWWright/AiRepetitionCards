import { TutorInferenceReplySchema, type TutorTokenUsage } from "@recall/ai-core";
import { Effect, Either, Schema } from "effect";
import { createLocalTutorApi } from "@recall/application";
import type { TutorApiFailure } from "@recall/application";
import "./desktop-api";
import { chatGptPlanFailureMessage, type ChatGptPlanFailure } from "./chatgpt-plan-errors";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

const Reply = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Unknown }),
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    code: Schema.String,
    status: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.between(100, 599)), {
      exact: true,
    }),
    recovery: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
const failure = (code: string, providerFailure?: ChatGptPlanFailure): TutorApiFailure => ({
  _tag: "TutorApiFailure",
  reason: "http",
  status: providerFailure?.status ?? 503,
  code: chatGptPlanFailureMessage(providerFailure ?? { code }),
});
export function createLocalChatGptTutor(
  profile: string,
  model: string,
  knowledgeAreaId: string,
  onUsage?: (usage: TutorTokenUsage) => void,
) {
  const key = (value: string) =>
    value.startsWith("session:")
      ? `recall-chatgpt-tutor:${profile}:${value.slice(8)}`
      : value.startsWith("proposal:")
        ? `recall-chatgpt-proposal-session:${profile}:${value.slice(9)}`
        : `recall-chatgpt-proposal-session:${profile}:resolution:${value.slice(11)}`;
  const assertCurrent = Effect.gen(function* () {
    const bridge = window.recallDesktop?.chatgpt;
    if (!bridge) return yield* Effect.fail(failure("local-chatgpt-unavailable"));
    const raw = yield* Effect.tryPromise({
      try: bridge.status,
      catch: () => failure("local-chatgpt-unavailable"),
    });
    const status = Schema.decodeUnknownEither(
      Schema.Struct({
        _tag: Schema.Literal("Success"),
        value: Schema.Struct({ activeClientId: Schema.NullOr(Schema.String) }),
      }),
    )(raw);
    if (Either.isLeft(status) || status.right.value.activeClientId !== profile)
      return yield* Effect.fail(failure("chatgpt-account-changed"));
  });
  return createLocalTutorApi({
    model,
    knowledgeAreaId,
    createId: () => crypto.randomUUID(),
    failure,
    assertCurrent,
    read: (value) =>
      Effect.try({
        try: () => volatileStorage.getItem(key(value)),
        catch: () => failure("local-session-storage-unavailable"),
      }),
    write: (entries) =>
      Effect.gen(function* () {
        if (localWritesBlocked())
          return yield* Effect.fail(failure("local-session-storage-unavailable"));
        yield* Effect.try({
          try: () => {
            for (const [name, value] of entries) volatileStorage.setItem(key(name), value);
          },
          catch: () => failure("local-session-storage-unavailable"),
        });
      }),
    infer: (input) =>
      Effect.gen(function* () {
        const bridge = window.recallDesktop?.chatgpt;
        if (!bridge) return yield* Effect.fail(failure("local-chatgpt-unavailable"));
        const raw = yield* Effect.tryPromise({
          try: () => bridge.respond({ ...input, expectedClientId: profile }),
          catch: () => failure("local-chatgpt-unavailable"),
        });
        const reply = Schema.decodeUnknownEither(Reply)(raw);
        if (Either.isLeft(reply)) return yield* Effect.fail(failure("invalid-response"));
        if (reply.right._tag === "Failure") {
          if (!["context-limit-exceeded", "context-count-unavailable"].includes(reply.right.code))
            window.dispatchEvent(new Event("recall-chatgpt-plan-state-changed"));
          return yield* Effect.fail(failure(reply.right.code, reply.right));
        }
        const response = yield* Schema.decodeUnknown(TutorInferenceReplySchema)(
          reply.right.value,
        ).pipe(Effect.mapError(() => failure("invalid-response")));
        if (response.usage.model !== model) return yield* Effect.fail(failure("invalid-response"));
        onUsage?.(response.usage);
        return response;
      }),
  });
}
