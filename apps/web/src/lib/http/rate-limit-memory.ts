import { Effect } from "effect";
import type { ApiRateLimitFailure, ApiRateLimitStore } from "@recall/application";

type Bucket = { readonly count: number; readonly expiresAt: number };

/** Per-process protection only. A distributed deployment needs an atomic shared store. */
export function createMemoryRateLimitStore(): ApiRateLimitStore {
  const buckets = new Map<string, Bucket>();
  const maximumBuckets = 10_000;
  return {
    consume: (input) =>
      Effect.suspend(() => {
        const key = JSON.stringify([input.subject, input.scope]);
        const previous = buckets.get(key);
        const active = previous && previous.expiresAt > input.now ? previous : undefined;
        if (!active && buckets.size >= maximumBuckets) {
          for (const [expiredKey, bucket] of buckets) {
            if (bucket.expiresAt <= input.now) buckets.delete(expiredKey);
          }
          if (!buckets.has(key) && buckets.size >= maximumBuckets) {
            return Effect.fail<ApiRateLimitFailure>({
              _tag: "ApiRateLimitUnavailable",
              reason: "capacity",
            });
          }
        }
        const expiresAt = active?.expiresAt ?? input.now + input.policy.windowMilliseconds;
        const count = active?.count ?? 0;
        const allowed = count < input.policy.requests;
        if (allowed) buckets.set(key, { count: count + 1, expiresAt });
        return Effect.succeed({
          allowed,
          remaining: Math.max(0, input.policy.requests - count - (allowed ? 1 : 0)),
          retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil((expiresAt - input.now) / 1000))),
        });
      }),
  };
}
