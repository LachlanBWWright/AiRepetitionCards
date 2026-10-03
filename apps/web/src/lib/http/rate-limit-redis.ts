import "server-only";
import { createHash } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import {
  ApiRateLimitScopeSchema,
  type ApiRateLimitFailure,
  type ApiRateLimitStore,
} from "@recall/application";
import { createMemoryRateLimitStore } from "./rate-limit-memory";

const unavailable = (): ApiRateLimitFailure => ({
  _tag: "ApiRateLimitUnavailable",
  reason: "store-unavailable",
});
const ConfigurationSchema = Schema.Struct({
  url: Schema.String,
  token: Schema.String.pipe(Schema.pattern(/^[\x21-\x7e]{1,4096}$/)),
  prefix: Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9:_-]{1,64}$/)),
});
type Configuration = typeof ConfigurationSchema.Type;
const ConsumeSchema = Schema.Struct({
  subject: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  scope: ApiRateLimitScopeSchema,
  now: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  policy: Schema.Struct({
    requests: Schema.Number.pipe(Schema.int(), Schema.between(1, 120)),
    windowMilliseconds: Schema.Number.pipe(Schema.int(), Schema.between(1000, 60_000)),
  }),
});
const ReplySchema = Schema.Struct({
  result: Schema.Tuple(
    Schema.Literal(0, 1),
    Schema.Number.pipe(Schema.int(), Schema.between(0, 120)),
    Schema.Number.pipe(Schema.int(), Schema.between(1, 60)),
  ),
});

// One EVAL is atomic. TIME is Redis-owned; caller clocks cannot extend or reset a window.
const consumeScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local width = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = math.floor(now / width)
local ttl = (window + 1) * width - now
local retry = math.max(1, math.ceil(ttl / 1000))
local previous = redis.call('HMGET', KEYS[1], 'window', 'count')
local count = 0
if previous[1] or previous[2] then
  local previousWindow = tonumber(previous[1])
  local previousCount = tonumber(previous[2])
  if not previousWindow or previousWindow < 0 or previousWindow > window or
    previousWindow ~= math.floor(previousWindow) or not previousCount or
    previousCount < 0 or previousCount > 120 or previousCount ~= math.floor(previousCount) then
    return {-1, 0, retry}
  end
  if previousWindow == window then count = previousCount end
end
if count >= limit then return {0, 0, retry} end
count = count + 1
redis.call('HSET', KEYS[1], 'window', window, 'count', count)
redis.call('PEXPIRE', KEYS[1], ttl + 1000)
return {1, limit - count, retry}
`;

function validatedConfiguration(input: unknown): Either.Either<Configuration, ApiRateLimitFailure> {
  return Effect.runSync(
    Effect.either(
      Schema.decodeUnknown(ConfigurationSchema)(input).pipe(
        Effect.mapError(unavailable),
        Effect.flatMap((configuration) =>
          Effect.try({ try: () => new URL(configuration.url), catch: unavailable }).pipe(
            Effect.flatMap((url) => {
              const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
              if (
                (url.protocol !== "https:" &&
                  !(
                    process.env.NODE_ENV === "development" &&
                    url.protocol === "http:" &&
                    loopback
                  )) ||
                url.username ||
                url.password ||
                url.search ||
                url.hash
              )
                return Effect.fail(unavailable());
              return Effect.succeed({ ...configuration, url: url.toString() });
            }),
          ),
        ),
      ),
    ),
  );
}

function command(configuration: Configuration, key: string, width: number, limit: number) {
  return Effect.tryPromise({
    try: async (): Promise<unknown> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(configuration.url, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            authorization: `Bearer ${configuration.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(["EVAL", consumeScript, 1, key, width, limit]),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return null;
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 4096) {
              await reader.cancel();
              return null;
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: unavailable,
  });
}

/** Shared REST Redis fixed windows; subject/IP text never appears in stored keys or failures. */
export function createRedisApiRateLimitStore(input: unknown): ApiRateLimitStore {
  const configuration = validatedConfiguration(input);
  return {
    consume: (input) =>
      Effect.gen(function* () {
        if (Either.isLeft(configuration)) return yield* Effect.fail(configuration.left);
        const request = yield* Schema.decodeUnknown(ConsumeSchema)(input).pipe(
          Effect.mapError((): ApiRateLimitFailure => ({
            _tag: "ApiRateLimitUnavailable",
            reason: "invalid-request",
          })),
        );
        const digest = yield* Effect.try({
          try: () =>
            createHash("sha256")
              .update(JSON.stringify([request.scope, request.subject]))
              .digest("hex"),
          catch: unavailable,
        });
        const raw = yield* command(
          configuration.right,
          `${configuration.right.prefix}:v1:${digest}`,
          request.policy.windowMilliseconds,
          request.policy.requests,
        );
        if (typeof raw !== "object" || raw === null || "error" in raw)
          return yield* Effect.fail(unavailable());
        const decoded = yield* Schema.decodeUnknown(ReplySchema)(raw).pipe(
          Effect.mapError(unavailable),
        );
        const [allowed, remaining, retryAfterSeconds] = decoded.result;
        if (
          (allowed === 0 && remaining !== 0) ||
          remaining >= request.policy.requests ||
          retryAfterSeconds > Math.ceil(request.policy.windowMilliseconds / 1000)
        )
          return yield* Effect.fail(unavailable());
        return { allowed: allowed === 1, remaining, retryAfterSeconds };
      }),
  };
}

/** Production defaults to shared Redis; configuration/vendor failures never downgrade to memory. */
export function createConfiguredApiRateLimitStore(): ApiRateLimitStore {
  const mode =
    process.env.API_RATE_LIMIT_MODE?.trim() ||
    (process.env.NODE_ENV === "production" ? "redis" : "memory");
  if (mode === "memory") return createMemoryRateLimitStore();
  if (mode !== "redis") return { consume: () => Effect.fail(unavailable()) };
  return createRedisApiRateLimitStore({
    url: process.env.API_RATE_LIMIT_STORE_REST_URL?.trim(),
    token: process.env.API_RATE_LIMIT_STORE_REST_TOKEN?.trim(),
    prefix: process.env.API_RATE_LIMIT_STORE_PREFIX?.trim() || "recall:api-rate-limit",
  });
}
