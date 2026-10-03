import "server-only";
import { Effect, Either } from "effect";
import type { AiUsageBudget, AiUsageBudgetFailure } from "@recall/application";

export type HostedAiBudgetConfiguration = {
  readonly url: string;
  readonly token: string;
  readonly prefix: string;
  readonly tokenBudget: number | null;
  readonly requestLimit: number;
};
const unavailable = (): AiUsageBudgetFailure => ({ _tag: "AiBudgetUnavailable" });
const positiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000_000 ? parsed : null;
};
/** Explicit limits require shared durable storage; malformed configuration never disables limits. */
export function readHostedAiBudgetConfiguration(): Either.Either<
  HostedAiBudgetConfiguration | null,
  AiUsageBudgetFailure
> {
  const budget = process.env.AI_DAILY_TOKEN_BUDGET?.trim();
  const limit = process.env.AI_DAILY_REQUEST_LIMIT?.trim();
  if (!budget && !limit) return Either.right(null);
  const tokenBudget = budget ? positiveInteger(budget) : null;
  const requestLimit = limit ? positiveInteger(limit) : 30;
  const token = process.env.AI_BUDGET_STORE_REST_TOKEN?.trim();
  const prefix = process.env.AI_BUDGET_STORE_PREFIX?.trim() || "recall:ai-budget";
  const url = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => new URL(process.env.AI_BUDGET_STORE_REST_URL ?? ""),
        catch: unavailable,
      }),
    ),
  );
  if (
    (budget && !tokenBudget) ||
    !requestLimit ||
    requestLimit > 30 ||
    !token ||
    !/^[a-zA-Z0-9:_-]{1,64}$/.test(prefix) ||
    Either.isLeft(url) ||
    url.right.protocol !== "https:" ||
    url.right.username ||
    url.right.password ||
    url.right.search ||
    url.right.hash
  )
    return Either.left(unavailable());
  return Either.right({ url: url.right.toString(), token, prefix, tokenBudget, requestLimit });
}

const reserveScript = `
local existing = redis.call('HGET', KEYS[2], 'units')
if existing then
  if redis.call('HGET', KEYS[2], 'fingerprint') ~= ARGV[4] then return -2 end
  return tonumber(existing)
end
local spent = tonumber(redis.call('HGET', KEYS[1], 'units') or '0')
local calls = tonumber(redis.call('HGET', KEYS[1], 'calls') or '0')
local hold = tonumber(ARGV[1])
if (tonumber(ARGV[2]) > 0 and spent + hold > tonumber(ARGV[2])) or calls >= tonumber(ARGV[3]) then return -1 end
redis.call('HINCRBY', KEYS[1], 'units', hold)
redis.call('HINCRBY', KEYS[1], 'calls', 1)
redis.call('HSET', KEYS[2], 'units', hold, 'fingerprint', ARGV[4])
redis.call('EXPIRE', KEYS[1], 259200)
redis.call('EXPIRE', KEYS[2], 259200)
return hold
`;
const settleScript = `
local hold = redis.call('HGET', KEYS[2], 'units')
if not hold or tonumber(hold) ~= tonumber(ARGV[1]) then return -2 end
local settled = redis.call('HGET', KEYS[2], 'settled')
if settled then
  if tonumber(settled) ~= tonumber(ARGV[2]) then return -2 end
  return 1
end
if redis.call('EXISTS', KEYS[1]) ~= 1 then return -2 end
redis.call('HINCRBY', KEYS[1], 'units', tonumber(ARGV[2]) - tonumber(hold))
redis.call('HSET', KEYS[2], 'settled', ARGV[2])
return 1
`;

/** A budget is bound to the authenticated account, operation and UTC admission day. */
export function createHostedAiUsageBudget(
  configuration: HostedAiBudgetConfiguration,
  ownerId: string,
  callId: string,
  now: Date,
): AiUsageBudget {
  const day = Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validBinding = uuid.test(ownerId) && uuid.test(callId) && day.length === 10;
  // A Redis hash tag keeps both atomic-script keys in one cluster slot.
  const counterKey = `${configuration.prefix}:{${ownerId}:${day}}:total`;
  const reservationKey = `${configuration.prefix}:{${ownerId}:${day}}:call:${callId}`;
  const bound = (input: {
    readonly userId: string;
    readonly operationId: string;
    readonly day: string;
  }) =>
    validBinding && input.userId === ownerId && input.operationId === callId && input.day === day;
  const command = (script: string, arguments_: readonly (string | number)[]) =>
    Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const response = await fetch(configuration.url, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            authorization: `Bearer ${configuration.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(["EVAL", script, 2, counterKey, reservationKey, ...arguments_]),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok || !response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
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
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return typeof body === "object" && body !== null && "result" in body && !("error" in body)
          ? body.result
          : null;
      },
      catch: unavailable,
    });
  return {
    reserve: (input) => {
      const units = input.requestBytes + input.maxOutputTokens;
      if (!bound(input) || !Number.isSafeInteger(units) || units <= 0)
        return Effect.fail(unavailable());
      const fingerprint = JSON.stringify([
        input.operation,
        input.model,
        input.requestBytes,
        input.maxOutputTokens,
      ]);
      return command(reserveScript, [
        units,
        configuration.tokenBudget ?? 0,
        configuration.requestLimit,
        fingerprint,
      ]).pipe(
        Effect.flatMap((result) => {
          if (result === -1) return Effect.fail({ _tag: "AiBudgetExceeded" } as const);
          if (result !== units) return Effect.fail(unavailable());
          return Effect.succeed({
            userId: ownerId,
            operationId: callId,
            day,
            reservedUnits: units,
          });
        }),
      );
    },
    settle: (input) => {
      const { reservation, inputTokens, outputTokens } = input;
      if (!bound(reservation)) return Effect.fail(unavailable());
      if (inputTokens === null || outputTokens === null) return Effect.void;
      const actual = inputTokens + outputTokens;
      if (
        !Number.isSafeInteger(actual) ||
        actual < 0 ||
        !Number.isSafeInteger(reservation.reservedUnits)
      )
        return Effect.fail(unavailable());
      return command(settleScript, [reservation.reservedUnits, actual]).pipe(
        Effect.flatMap((result) => (result === 1 ? Effect.void : Effect.fail(unavailable()))),
      );
    },
  };
}
