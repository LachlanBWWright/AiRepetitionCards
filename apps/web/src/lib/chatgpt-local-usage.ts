import { LocalAiUsageSnapshotSchema, type LocalAiUsageSnapshot } from "@recall/application";
import { Effect, Schema } from "effect";
import { chatGptPlanFailureMessage } from "./chatgpt-plan-errors";
import "./desktop-api";

export type LocalChatGPTUsageFailure = {
  readonly _tag: "LocalChatGPTUsageFailure";
  readonly message: string;
};
const failure = (message: string): LocalChatGPTUsageFailure => ({
  _tag: "LocalChatGPTUsageFailure",
  message,
});
const Reply = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Unknown }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), code: Schema.String }),
);

/** Main-process storage owns the token ledger; credentials never cross this boundary. */
function requestSnapshot(
  accountId: string,
): Effect.Effect<LocalAiUsageSnapshot, LocalChatGPTUsageFailure> {
  return Effect.gen(function* () {
    const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.chatgpt;
    if (!bridge)
      return yield* Effect.fail(failure("Local ChatGPT usage is available in the desktop app."));
    const raw = yield* Effect.tryPromise({
      try: () => bridge.usage(accountId),
      catch: () => failure("Local AI usage could not be accessed."),
    });
    const reply = yield* Schema.decodeUnknown(Reply)(raw).pipe(
      Effect.mapError(() => failure("The local usage response could not be validated.")),
    );
    if (reply._tag === "Failure")
      return yield* Effect.fail(failure(chatGptPlanFailureMessage(reply)));
    const snapshot = yield* Schema.decodeUnknown(LocalAiUsageSnapshotSchema)(reply.value).pipe(
      Effect.mapError(() => failure("The local usage response could not be validated.")),
    );
    if (
      snapshot.policy.accountId !== accountId ||
      snapshot.entries.some((entry) => entry.accountId !== accountId)
    )
      return yield* Effect.fail(failure("The selected ChatGPT account changed."));
    return snapshot;
  });
}

/** Usage describes this installation only, never the remaining ChatGPT allowance. */
export const localChatGPTUsageApi = {
  read: (accountId: string): Effect.Effect<LocalAiUsageSnapshot, LocalChatGPTUsageFailure> =>
    requestSnapshot(accountId),
};
