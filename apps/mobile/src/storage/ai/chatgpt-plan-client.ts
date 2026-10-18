import { Effect, Either, Schema } from "effect";
import {
  chatGPTTutorBody,
  completedChatGPTText,
  readChatGPTStream,
} from "@recall/infra-openai/chatgpt-inference";
import { chatGptPlanFailureMessage } from "@recall/infra-openai/chatgpt-plan-errors";
import type { LocalTutorInference, TutorApiFailure } from "@recall/application";
import type { createChatGPTAuth } from "../auth/chatgpt-auth";

export const nativePlanFailure = (code: string, status?: number): TutorApiFailure => ({
  _tag: "TutorApiFailure",
  reason: "http",
  status: status ?? 503,
  code: chatGptPlanFailureMessage({ code, ...(status === undefined ? {} : { status }) }),
});
const Model = Schema.Struct({
  slug: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  display_name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  visibility: Schema.String,
});
export type NativeChatGPTModel = typeof Model.Type;
const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
  }),
});
const StreamError = Schema.Struct({
  response: Schema.optional(ErrorEnvelope),
  error: Schema.optional(ErrorEnvelope.fields.error),
});
function providerCode(value: unknown): string {
  const direct = Schema.decodeUnknownEither(ErrorEnvelope)(value);
  if (Either.isRight(direct))
    return direct.right.error.code ?? direct.right.error.type ?? "provider-error";
  const event = Schema.decodeUnknownEither(StreamError)(value);
  if (Either.isRight(event)) {
    const error = event.right.response?.error ?? event.right.error;
    return error?.code ?? error?.type ?? "provider-error";
  }
  return "provider-error";
}

/** Native HTTP adapter: keeps OAuth tokens on-device and accepts only terminal streamed output. */
export function createNativeChatGPTPlanClient(ports: {
  readonly auth: Pick<
    ReturnType<typeof createChatGPTAuth>,
    "status" | "accessToken" | "epoch" | "subscribe"
  >;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}) {
  let inferenceBusy = false;
  const assertCurrent = (clientId: string, epoch = ports.auth.epoch()) =>
    Effect.gen(function* () {
      const status = yield* ports.auth.status.pipe(
        Effect.mapError((error) => nativePlanFailure(error.code)),
      );
      const account = status.accounts.find((item) => item.clientId === clientId);
      if (ports.auth.epoch() !== epoch || status.activeClientId !== clientId || !account?.signedIn)
        return yield* Effect.fail(nativePlanFailure("account-changed"));
      if (!account.planEnabled)
        return yield* Effect.fail(nativePlanFailure("plan-permission-required"));
    });
  function request<A>(
    clientId: string,
    path: "models" | "responses",
    body: unknown,
    consume: (response: Response) => Effect.Effect<A, TutorApiFailure>,
  ) {
    return Effect.gen(function* () {
      const epoch = ports.auth.epoch();
      yield* assertCurrent(clientId, epoch);
      const token = yield* ports.auth
        .accessToken(clientId)
        .pipe(Effect.mapError((error) => nativePlanFailure(error.code)));
      yield* assertCurrent(clientId, epoch);
      const controller = new AbortController();
      let timedOut = false;
      const unsubscribe = ports.auth.subscribe(() => {
        if (ports.auth.epoch() !== epoch) controller.abort();
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ports.timeoutMs ?? 60_000);
      return yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            ports.fetch(`https://api.openai.com/v1/${path}`, {
              method: body === undefined ? "GET" : "POST",
              headers: {
                authorization: `Bearer ${token}`,
                accept: path === "responses" ? "text/event-stream" : "application/json",
                ...(body === undefined ? {} : { "content-type": "application/json" }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal: controller.signal,
              redirect: "error",
            }),
          catch: () => nativePlanFailure(requestFailureCode(timedOut, controller.signal)),
        });
        if (!response.ok) {
          const raw = yield* readJson(response);
          return yield* Effect.fail(nativePlanFailure(providerCode(raw), response.status));
        }
        const result = yield* consume(response);
        yield* assertCurrent(clientId, epoch);
        return result;
      }).pipe(
        Effect.mapError((error) =>
          timedOut
            ? nativePlanFailure("request-timeout")
            : controller.signal.aborted
              ? nativePlanFailure("inference-cancelled")
              : error,
        ),
        Effect.ensuring(
          Effect.sync(() => {
            clearTimeout(timeout);
            unsubscribe();
            controller.abort();
          }),
        ),
      );
    });
  }
  const models = (clientId: string) =>
    request(clientId, "models", undefined, (response) =>
      readJson(response).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknown(
            Schema.Struct({ models: Schema.Array(Model).pipe(Schema.maxItems(500)) }),
          )(raw),
        ),
        Effect.map((value) => value.models.filter((model) => model.visibility === "list")),
        Effect.mapError(() => nativePlanFailure("invalid-response")),
      ),
    );
  const infer = (clientId: string, input: LocalTutorInference) =>
    Effect.suspend(() => {
      if (inferenceBusy) return Effect.fail(nativePlanFailure("inference-in-progress"));
      inferenceBusy = true;
      return request(clientId, "responses", chatGPTTutorBody(input), (response) =>
        readChatGPTStream(response).pipe(
          Effect.mapError((error) =>
            nativePlanFailure(
              error.code === "provider-error"
                ? providerCode(error.providerError ?? { response: error.response })
                : error.code,
            ),
          ),
          Effect.flatMap((terminal) => {
            const output = completedChatGPTText(terminal);
            return Either.isRight(output)
              ? Effect.succeed(output.right)
              : Effect.fail(nativePlanFailure(output.left));
          }),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            inferenceBusy = false;
          }),
        ),
      );
    });
  return { models, infer, assertCurrent };
}

/** Bound catalog/error bodies as well as streamed inference; never return vendor prose. */
function readJson(response: Response): Effect.Effect<unknown, TutorApiFailure> {
  return Effect.gen(function* () {
    const reader = response.body?.getReader();
    if (!reader) return yield* Effect.fail(nativePlanFailure("invalid-response"));
    const decoder = new TextDecoder();
    let value = "";
    let bytes = 0;
    return yield* Effect.gen(function* () {
      for (;;) {
        const part = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: () => nativePlanFailure("network-unavailable"),
        });
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 256_000) return yield* Effect.fail(nativePlanFailure("response-too-large"));
        value += decoder.decode(part.value, { stream: true });
      }
      value += decoder.decode();
      return yield* Effect.try({
        try: (): unknown => JSON.parse(value),
        catch: () => nativePlanFailure("invalid-response"),
      });
    }).pipe(
      Effect.ensuring(
        Effect.tryPromise({ try: () => reader.cancel(), catch: () => undefined }).pipe(
          Effect.ignore,
        ),
      ),
    );
  });
}

function requestFailureCode(timedOut: boolean, signal: AbortSignal): string {
  if (timedOut) return "request-timeout";
  return signal.aborted ? "inference-cancelled" : "network-unavailable";
}
