import {
  LocalAiUsagePolicySchema,
  LocalAiUsageSnapshotSchema,
  type LocalAiUsageSnapshot,
} from "@recall/application";
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

/** Main-process storage owns admission; renderer preferences cannot bypass a budget. */
function requestSnapshot(
  accountId: string,
  operation: "read" | "write",
  input: unknown,
): Effect.Effect<LocalAiUsageSnapshot, LocalChatGPTUsageFailure> {
  return Effect.gen(function* () {
    const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.chatgpt;
    if (!bridge)
      return yield* Effect.fail(failure("Local ChatGPT usage is available in the desktop app."));
    const raw = yield* Effect.tryPromise({
      try: () => (operation === "read" ? bridge.usage(accountId) : bridge.setBudget(input)),
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
    if (operation === "write") window.dispatchEvent(new Event("recall-chatgpt-plan-state-changed"));
    return snapshot;
  });
}

/** Usage describes this installation only, never the remaining ChatGPT allowance. */
export const localChatGPTUsageApi = {
  read: (accountId: string): Effect.Effect<LocalAiUsageSnapshot, LocalChatGPTUsageFailure> =>
    requestSnapshot(accountId, "read", null),
  setBudget: (input: unknown): Effect.Effect<LocalAiUsageSnapshot, LocalChatGPTUsageFailure> =>
    Schema.decodeUnknown(LocalAiUsagePolicySchema)(input).pipe(
      Effect.mapError(() => failure("Use nonnegative whole-number limits, or null for no limit.")),
      Effect.flatMap((policy) => requestSnapshot(policy.accountId, "write", policy)),
    ),
};
