import "server-only";
import { createHmac } from "node:crypto";
import { Effect, Either, Schema } from "effect";

const Nonempty = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2048));
const UserId = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
);
const TransactionSchema = Schema.Struct({
  state: Nonempty,
  nonce: Nonempty,
  codeVerifier: Nonempty,
  codeChallenge: Nonempty,
  redirectUri: Nonempty,
  next: Nonempty,
  mode: Schema.Literal("sign-in", "link"),
  linkedUserId: Schema.NullOr(UserId),
  createdAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
const IdentitySchema = Schema.Struct({ issuer: Nonempty, clientId: Nonempty, subject: Nonempty });

export type OpenAiStoredTransaction = typeof TransactionSchema.Type;
export type OpenAiStoreIdentity = typeof IdentitySchema.Type;
export type OpenAiStoreError = {
  readonly _tag: "OpenAiStoreError";
  readonly reason: "configuration" | "unavailable" | "invalid-data" | "conflict";
};
export type OpenAiStoreConfiguration = {
  readonly url: string;
  readonly token: string;
  readonly identityKeySecret: string;
  readonly prefix?: string;
};

const failure = (reason: OpenAiStoreError["reason"]): OpenAiStoreError => ({
  _tag: "OpenAiStoreError",
  reason,
});
const browserIdIsValid = (value: string): boolean => /^[a-zA-Z0-9_-]{32,128}$/.test(value);

/** Read only a bounded response; credentials and vendor responses never enter failure values. */
function readReply(response: Response): Effect.Effect<unknown, OpenAiStoreError> {
  return Effect.tryPromise({
    try: async () => {
      if (!response.ok || response.body === null) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 32_768) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk.value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(body)) as unknown;
    },
    catch: () => failure("unavailable"),
  });
}

const bindScript = `
local existing = redis.call('GET', KEYS[1])
if existing and existing ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[2], KEYS[1])
return 1
`;
const cleanupScript = `
local identities = redis.call('SMEMBERS', KEYS[1])
for _, key in ipairs(identities) do
  if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key) end
end
redis.call('DEL', KEYS[1])
return 1
`;

/** Durable shared storage; SET NX and GETDEL preserve one-time callback semantics across instances. */
export function createOpenAiSignInStore(configuration: OpenAiStoreConfiguration) {
  const prefix = configuration.prefix ?? "recall:siwc";
  const configured = Effect.try({
    try: () => new URL(configuration.url),
    catch: () => failure("configuration"),
  }).pipe(
    Effect.flatMap((url) =>
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      configuration.token.length > 0 &&
      configuration.identityKeySecret.length >= 32 &&
      /^[a-zA-Z0-9:_-]{1,64}$/.test(prefix)
        ? Effect.succeed(url.toString())
        : Effect.fail(failure("configuration")),
    ),
  );
  const command = (arguments_: readonly (string | number)[]) =>
    configured.pipe(
      Effect.flatMap((url) =>
        Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "POST",
              redirect: "error",
              headers: {
                authorization: `Bearer ${configuration.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(arguments_),
              signal: AbortSignal.timeout(10_000),
              cache: "no-store",
            }),
          catch: () => failure("unavailable"),
        }),
      ),
      Effect.flatMap(readReply),
      Effect.flatMap((body) =>
        typeof body === "object" && body !== null && "result" in body && !("error" in body)
          ? Effect.succeed(body.result)
          : Effect.fail(failure("unavailable")),
      ),
    );
  const identityKey = (identity: OpenAiStoreIdentity): Effect.Effect<string, OpenAiStoreError> => {
    const parsed = Schema.decodeUnknownEither(IdentitySchema)(identity);
    if (Either.isLeft(parsed)) return Effect.fail(failure("invalid-data"));
    return configured.pipe(
      Effect.flatMap(() =>
        Effect.try({
          try: () =>
            createHmac("sha256", configuration.identityKeySecret)
              .update(
                JSON.stringify([parsed.right.issuer, parsed.right.clientId, parsed.right.subject]),
              )
              .digest("hex"),
          catch: () => failure("configuration"),
        }),
      ),
    );
  };
  const userKey = (userId: string): string => `${prefix}:user:${userId}`;
  const validUserId = (userId: string): boolean =>
    Either.isRight(Schema.decodeUnknownEither(UserId)(userId));

  return {
    identityKey,
    createTransaction: (
      browserId: string,
      transaction: OpenAiStoredTransaction,
    ): Effect.Effect<void, OpenAiStoreError> => {
      const parsed = Schema.decodeUnknownEither(TransactionSchema)(transaction);
      if (!browserIdIsValid(browserId) || Either.isLeft(parsed)) {
        return Effect.fail(failure("invalid-data"));
      }
      return command([
        "SET",
        `${prefix}:transaction:${browserId}`,
        JSON.stringify(parsed.right),
        "NX",
        "PX",
        600_000,
      ]).pipe(
        Effect.flatMap((result) =>
          result === "OK"
            ? Effect.void
            : Effect.fail(failure(result === null ? "conflict" : "unavailable")),
        ),
      );
    },
    consumeTransaction: (
      browserId: string,
    ): Effect.Effect<OpenAiStoredTransaction | null, OpenAiStoreError> => {
      if (!browserIdIsValid(browserId)) return Effect.fail(failure("invalid-data"));
      return command(["GETDEL", `${prefix}:transaction:${browserId}`]).pipe(
        Effect.flatMap((result) => {
          if (result === null) return Effect.succeed(null);
          if (typeof result !== "string") return Effect.fail(failure("invalid-data"));
          return Effect.try({
            try: () => JSON.parse(result) as unknown,
            catch: () => failure("invalid-data"),
          }).pipe(
            Effect.flatMap((value) => {
              const parsed = Schema.decodeUnknownEither(TransactionSchema)(value);
              return Either.isRight(parsed)
                ? Effect.succeed(parsed.right)
                : Effect.fail(failure("invalid-data"));
            }),
          );
        }),
      );
    },
    readIdentity: (identity: OpenAiStoreIdentity): Effect.Effect<string | null, OpenAiStoreError> =>
      identityKey(identity).pipe(
        Effect.flatMap((key) => command(["GET", `${prefix}:identity:${key}`])),
        Effect.flatMap((result) =>
          result === null || (typeof result === "string" && validUserId(result))
            ? Effect.succeed(result)
            : Effect.fail(failure("invalid-data")),
        ),
      ),
    bindIdentity: (
      identity: OpenAiStoreIdentity,
      userId: string,
    ): Effect.Effect<void, OpenAiStoreError> => {
      if (!validUserId(userId)) return Effect.fail(failure("invalid-data"));
      return identityKey(identity).pipe(
        Effect.flatMap((key) =>
          command(["EVAL", bindScript, 2, `${prefix}:identity:${key}`, userKey(userId), userId]),
        ),
        Effect.flatMap((result) =>
          result === 1
            ? Effect.void
            : Effect.fail(failure(result === 0 ? "conflict" : "unavailable")),
        ),
      );
    },
    deleteUserIdentities: (userId: string): Effect.Effect<void, OpenAiStoreError> => {
      if (!validUserId(userId)) return Effect.fail(failure("invalid-data"));
      return command(["EVAL", cleanupScript, 1, userKey(userId), userId]).pipe(
        Effect.flatMap((result) =>
          result === 1 ? Effect.void : Effect.fail(failure("unavailable")),
        ),
      );
    },
  };
}
