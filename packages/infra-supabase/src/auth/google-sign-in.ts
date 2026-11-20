import { Effect, Either } from "effect";

export type GoogleSignInFailure = {
  readonly _tag: "GoogleSignInFailure";
  readonly reason: "authorization" | "browser" | "callback";
};

const failure = (reason: GoogleSignInFailure["reason"]): GoogleSignInFailure => ({
  _tag: "GoogleSignInFailure",
  reason,
});

/** Open only the configured auth service's Google authorization endpoint. */
export function startGoogleSignIn(
  authOrigin: string,
  authorize: () => Promise<{
    readonly data: { readonly url: string | null };
    readonly error: unknown;
  }>,
  openBrowser: (url: string) => Promise<void>,
): Effect.Effect<void, GoogleSignInFailure> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: authorize,
      catch: () => failure("authorization"),
    });
    if (result.error || !result.data.url) return yield* Effect.fail(failure("authorization"));
    const url = yield* Effect.try({
      try: () => new URL(result.data.url ?? ""),
      catch: () => failure("authorization"),
    });
    const expected = yield* Effect.try({
      try: () => new URL(authOrigin),
      catch: () => failure("authorization"),
    });
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.origin !== expected.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== "/auth/v1/authorize" ||
      url.searchParams.getAll("provider").length !== 1 ||
      url.searchParams.get("provider") !== "google"
    )
      return yield* Effect.fail(failure("authorization"));
    yield* Effect.tryPromise({
      try: () => openBrowser(url.toString()),
      catch: () => failure("browser"),
    });
  });
}

/** PKCE binds an intercepted or replayed code to the client that started sign-in. */
export function googleSignInCallbackCode(input: unknown, callback: string): string | null {
  if (typeof input !== "string" || input.length > 8_192) return null;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => ({ url: new URL(input), expected: new URL(callback) }),
        catch: () => failure("callback"),
      }),
    ),
  );
  if (Either.isLeft(parsed)) return null;
  const { url, expected } = parsed.right;
  const codes = url.searchParams.getAll("code");
  if (
    url.protocol !== expected.protocol ||
    url.host !== expected.host ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.has("error") ||
    url.searchParams.has("token_hash") ||
    codes.length !== 1 ||
    !codes[0] ||
    codes[0].length > 2_000
  )
    return null;
  return codes[0];
}

export function completeGoogleSignIn(
  input: unknown,
  callback: string,
  exchange: (code: string) => Promise<{ readonly error: unknown }>,
): Effect.Effect<boolean, GoogleSignInFailure> {
  const code = googleSignInCallbackCode(input, callback);
  if (!code) return Effect.succeed(false);
  return Effect.tryPromise({
    try: () => exchange(code),
    catch: () => failure("callback"),
  }).pipe(Effect.map((result) => result.error === null));
}
