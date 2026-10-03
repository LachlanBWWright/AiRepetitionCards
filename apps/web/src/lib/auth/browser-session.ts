import { Effect, Schema } from "effect";
import { AuthSessionResponseSchema } from "@recall/contracts";

/** Browser UI receives account status; first-party session credentials stay in HttpOnly cookies. */
export function readBrowserSession() {
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
