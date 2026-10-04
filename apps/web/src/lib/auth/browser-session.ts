import { Effect, Schema } from "effect";
import { AuthSessionResponseSchema } from "@recall/contracts";
import type { AuthSessionResponse } from "@recall/contracts";
import { readSupabaseConfig } from "@/lib/supabase/config";

/** Browser UI receives account status; first-party session credentials stay in HttpOnly cookies. */
export function readBrowserSession() {
  const desktop = typeof window === "undefined" ? undefined : window.recallDesktop;
  if (desktop)
    return Effect.tryPromise({
      try: () => desktop.auth.getStatus(),
      catch: () => ({ _tag: "BrowserSessionUnavailable" }) as const,
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknown(
          Schema.Struct({
            _tag: Schema.Literal("Success"),
            value: Schema.Struct({
              email: Schema.NullOr(Schema.String),
              ownerId: Schema.NullOr(Schema.String),
            }),
          }),
        ),
      ),
      Effect.map(({ value }) => ({
        schemaVersion: 1,
        authenticated: value.ownerId !== null,
        displayLabel: value.email,
        ownerId: value.ownerId,
      })),
      Effect.flatMap(Schema.decodeUnknown(AuthSessionResponseSchema)),
    );
  if (readSupabaseConfig()._tag === "Left")
    return Effect.succeed<AuthSessionResponse>({
      schemaVersion: 1,
      authenticated: false,
      displayLabel: null,
      ownerId: null,
    });
  return Effect.tryPromise({
    try: (signal) =>
      fetch("/api/v1/auth/session", { signal, cache: "no-store", credentials: "same-origin" }),
    catch: () => ({ _tag: "BrowserSessionUnavailable" }) as const,
  }).pipe(
    Effect.filterOrFail(
      (response) => response.ok,
      () => ({ _tag: "BrowserSessionUnavailable" }) as const,
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: (): Promise<unknown> => response.json(),
        catch: () => ({ _tag: "BrowserSessionUnavailable" }) as const,
      }),
    ),
    Effect.flatMap(Schema.decodeUnknown(AuthSessionResponseSchema)),
  );
}
