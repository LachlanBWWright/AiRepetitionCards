import "server-only";
import { Effect, Either } from "effect";
import { checkApiRateLimit, type ApiRateLimitScope } from "@recall/application";
import type { NextResponse } from "next/server";
import { privateJson } from "./private-json";
import { createConfiguredApiRateLimitStore } from "./rate-limit-redis";
import { trustedClientIpSubject } from "./trusted-client-ip";

const store = createConfiguredApiRateLimitStore();

type HttpRateLimitOptions = {
  readonly namespace?: "account" | "media-read" | "media-write" | "publication-write";
  readonly publication?: boolean;
  readonly request: Request;
  readonly ipNamespace?: "anonymous-publication";
};

/** Call only after verified authentication, before parsing bodies or accessing repositories. */
export async function authenticatedApiRateLimit(
  userId: string,
  scope: ApiRateLimitScope,
  options: HttpRateLimitOptions,
): Promise<NextResponse | null> {
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const ip = yield* trustedClientIpSubject(options.request);
        if (ip !== null) {
          const ipDecision = yield* checkApiRateLimit(
            {
              subject: `ip:${options.ipNamespace ?? options.namespace ?? "application"}:${ip}`,
              scope,
              now: Date.now(),
            },
            store,
          );
          if (!ipDecision.allowed) return ipDecision;
        }
        return yield* checkApiRateLimit(
          {
            subject: options.namespace ? `${options.namespace}:${userId}` : userId,
            scope,
            now: Date.now(),
          },
          store,
        );
      }),
    ),
  );
  if (Either.isLeft(result)) {
    return privateJson(
      {
        ...(options.publication ? { schemaVersion: 1 } : {}),
        error: options.publication ? "publication-unavailable" : "rate-limit-unavailable",
        retryAfterSeconds: 60,
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (result.right.allowed) return null;
  return privateJson(
    {
      ...(options.publication ? { schemaVersion: 1 } : {}),
      error: options.publication ? "publication-unavailable" : "rate-limited",
      retryAfterSeconds: result.right.retryAfterSeconds,
    },
    { status: 429, headers: { "Retry-After": String(result.right.retryAfterSeconds) } },
  );
}

/** Shared anonymous origin bucket: never trust caller-supplied IP headers as identity. */
export function anonymousPublicationRateLimit(request: Request): Promise<NextResponse | null> {
  return authenticatedApiRateLimit("anonymous-publication", "review-sync", {
    publication: true,
    request,
    ipNamespace: "anonymous-publication",
  });
}
