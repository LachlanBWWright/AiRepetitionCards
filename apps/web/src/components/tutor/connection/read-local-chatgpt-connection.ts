import { Effect, Either, Schema } from "effect";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
import { Status, Models } from "./local-chatgpt-status";
const Reply = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Unknown }),
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    code: Schema.String,
    status: Schema.optionalWith(Schema.Number, { exact: true }),
    recovery: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
const decodeReply = (raw: unknown) =>
  Schema.decodeUnknown(Reply)(raw).pipe(
    Effect.mapError(() => "The desktop app returned an invalid ChatGPT response."),
    Effect.flatMap((reply) =>
      reply._tag === "Success"
        ? Effect.succeed(reply.value)
        : Effect.fail(chatGptPlanFailureMessage(reply)),
    ),
  );
/** Reconcile after model loading: token refresh can invalidate saved credentials. */
export function readLocalChatGPTConnection(
  bridge: { readonly status: () => Promise<unknown>; readonly models: () => Promise<unknown> },
  onStatus?: (state: typeof Status.Type) => void,
) {
  const status = () =>
    Effect.tryPromise({
      try: bridge.status,
      catch: () => "ChatGPT account status unavailable.",
    }).pipe(
      Effect.flatMap(decodeReply),
      Effect.flatMap((raw) =>
        Schema.decodeUnknown(Status)(raw).pipe(
          Effect.mapError(() => "Invalid ChatGPT account status."),
        ),
      ),
    );
  return Effect.gen(function* () {
    const before = yield* status();
    onStatus?.(before);
    const account = before.accounts.find((item) => item.clientId === before.activeClientId);
    if (!account?.signedIn || !account.planEnabled)
      return { state: before, models: [], message: null };
    const catalog = yield* Effect.either(
      Effect.tryPromise({
        try: bridge.models,
        catch: () => "Model catalog unavailable. Retry the connection check.",
      }).pipe(
        Effect.flatMap(decodeReply),
        Effect.flatMap((raw) =>
          Schema.decodeUnknown(Models)(raw).pipe(Effect.mapError(() => "Invalid model catalog.")),
        ),
      ),
    );
    const after = yield* status();
    const current = after.accounts.find((item) => item.clientId === after.activeClientId);
    const sameAccount =
      current?.signedIn && current.planEnabled && current.clientId === account.clientId;
    return {
      state: after,
      models: sameAccount && Either.isRight(catalog) ? catalog.right : [],
      message: Either.isLeft(catalog)
        ? catalog.left
        : sameAccount && catalog.right.length === 0
          ? "No models are available for this ChatGPT account. Retry the connection check or reconnect ChatGPT."
          : null,
    };
  });
}
