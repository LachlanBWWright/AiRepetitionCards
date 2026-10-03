import { Effect, Either, Schema } from "effect";

export type IntegrationFailure = {
  readonly _tag: "IntegrationFailure";
  readonly message: string;
};
export const failure = (message: string): IntegrationFailure => ({
  _tag: "IntegrationFailure",
  message,
});
export const verify = (
  condition: boolean,
  message: string,
): Effect.Effect<void, IntegrationFailure> =>
  condition ? Effect.void : Effect.fail(failure(message));
const ConfigurationSchema = Schema.Struct({
  url: Schema.String,
  publishableKey: Schema.String.pipe(Schema.minLength(1)),
  serviceRoleKey: Schema.String.pipe(Schema.minLength(1)),
});
export type Configuration = typeof ConfigurationSchema.Type;
export type Identity = { readonly key: string; readonly token: string | null };
export type Reply = { readonly status: number; readonly body: unknown; readonly bytes: Uint8Array };

export function configuration() {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(ConfigurationSchema)({
      url: process.env.RECALL_INTEGRATION_SUPABASE_URL,
      publishableKey: process.env.RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: process.env.RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY,
    }).pipe(
      Effect.mapError(() =>
        failure("Explicit local Supabase integration configuration is required."),
      ),
    );
    const url = yield* Effect.try({
      try: () => new URL(decoded.url),
      catch: () => failure("Invalid integration URL."),
    });
    yield* verify(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/",
      "Integration URL must identify a loopback Supabase instance.",
    );
    return { ...decoded, url: url.origin };
  });
}

/** Vendor failures expose only the operation/status, never credentials or raw response content. */
export function request(
  config: Configuration,
  identity: Identity,
  path: string,
  options: {
    readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
    readonly body?: unknown;
    readonly bytes?: Uint8Array;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Effect.Effect<Reply, IntegrationFailure> {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 15_000);
      try {
        const response = await fetch(`${config.url}${path}`, {
          method: options.method ?? "GET",
          redirect: "error",
          cache: "no-store",
          headers: {
            apikey: identity.key,
            ...(identity.token ? { authorization: `Bearer ${identity.token}` } : {}),
            "content-type": "application/json",
            ...options.headers,
          },
          ...(options.bytes
            ? { body: new Uint8Array(options.bytes).buffer }
            : options.body === undefined
              ? {}
              : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
        });
        const chunks: Uint8Array[] = [];
        let length = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              length += next.value.byteLength;
              if (length > 1_048_576) {
                await reader.cancel();
                return null;
              }
              chunks.push(next.value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const body: unknown =
          response.headers.get("content-type")?.includes("json") && length > 0
            ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
            : null;
        return { status: response.status, body, bytes };
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: () => failure("Supabase integration request could not complete."),
  }).pipe(
    Effect.flatMap((reply) =>
      reply === null
        ? Effect.fail(failure("Integration response exceeded its bound."))
        : Effect.succeed(reply),
    ),
  );
}

export const successful = (reply: Reply, label: string) =>
  verify(
    reply.status >= 200 && reply.status < 300,
    `${label}: unexpected HTTP ${String(reply.status)}.`,
  );

export function rows(reply: Reply, label: string) {
  return Effect.gen(function* () {
    yield* successful(reply, label);
    return yield* Schema.decodeUnknown(Schema.Array(Schema.Unknown))(reply.body).pipe(
      Effect.mapError(() => failure(`${label}: expected a validated row array.`)),
    );
  });
}

export const denied = (reply: Reply): boolean => {
  if ([401, 403, 404].includes(reply.status)) return true;
  if (
    reply.status === 400 &&
    typeof reply.body === "object" &&
    reply.body !== null &&
    "statusCode" in reply.body &&
    ["401", "403", "404"].includes(String(reply.body.statusCode))
  )
    return true;
  const result = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(reply.body);
  return (
    reply.status >= 200 && reply.status < 300 && Either.isRight(result) && result.right.length === 0
  );
};
