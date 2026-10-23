import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  startGoogleSignIn,
  completeGoogleSignIn,
  googleSignInCallbackCode,
} from "@recall/infra-supabase/google-sign-in";

const origin = "https://recall.supabase.co";
const authorization = `${origin}/auth/v1/authorize?provider=google&code_challenge=challenge`;
const callback = "recall://auth/confirm";

await test("Google sign-in opens only the configured auth service's authorization URL", async () => {
  const opened: string[] = [];
  const result = await Effect.runPromise(
    Effect.either(
      startGoogleSignIn(
        origin,
        () => Promise.resolve({ data: { url: authorization }, error: null }),
        (url) => {
          opened.push(url);
          return Promise.resolve();
        },
      ),
    ),
  );
  assert.equal(Either.isRight(result), true);
  assert.deepEqual(opened, [authorization]);
  for (const url of [
    "https://attacker.example/auth/v1/authorize?provider=google",
    `${origin}/auth/v1/authorize?provider=apple`,
    `${origin}/auth/v1/authorize?provider=google&provider=apple`,
    `${origin}/other?provider=google`,
    "javascript:alert(1)",
    "http://recall.supabase.co/auth/v1/authorize?provider=google",
  ]) {
    const rejected = await Effect.runPromise(
      Effect.either(
        startGoogleSignIn(
          origin,
          () => Promise.resolve({ data: { url }, error: null }),
          () => {
            assert.fail("Unsafe authorization URL must not open");
          },
        ),
      ),
    );
    assert.equal(Either.isLeft(rejected), true, url);
  }
});

await test("provider and browser failures are classified without claiming sign-in succeeded", async () => {
  const result = await Effect.runPromise(
    Effect.either(
      startGoogleSignIn(
        origin,
        () => Promise.resolve({ data: { url: null }, error: { message: "disabled" } }),
        () => {
          assert.fail("Disabled provider must not open");
        },
      ),
    ),
  );
  assert.equal(Either.isLeft(result), true);
  const failed = await Effect.runPromise(
    Effect.either(
      startGoogleSignIn(
        origin,
        () => Promise.resolve({ data: { url: authorization }, error: null }),
        () => Promise.reject(new Error("browser unavailable")),
      ),
    ),
  );
  assert.equal(Either.isLeft(failed) && failed.left.reason, "browser");
});

await test("PKCE callbacks reject foreign, ambiguous, error and legacy email links before exchange", async () => {
  for (const input of [
    "https://attacker.example/auth/confirm?code=stolen",
    "recall://auth/other?code=code",
    "recall://auth/confirm?code=first&code=second",
    "recall://auth/confirm?code=code&error=access_denied",
    "recall://auth/confirm?token_hash=hash&type=email",
    "recall://auth/confirm?code=code&token_hash=hash",
    "recall://auth/confirm#access_token=token",
    "recall://auth/confirm?code=",
    "recall://auth/confirm?code=" + "x".repeat(2_001),
    null,
  ]) {
    const result = await Effect.runPromise(
      completeGoogleSignIn(input, callback, () => {
        assert.fail("Invalid callback must not exchange a credential");
      }),
    );
    assert.equal(result, false);
  }
  assert.equal(googleSignInCallbackCode(`${callback}?code=valid`, callback), "valid");
});

await test("valid native and web callback codes use the initiating client's PKCE exchange", async () => {
  for (const target of [callback, "https://recall.example/auth/confirm"]) {
    const exchanged: string[] = [];
    const result = await Effect.runPromise(
      completeGoogleSignIn(`${target}?code=valid&next=%2F`, target, (code) => {
        exchanged.push(code);
        return Promise.resolve({ error: null });
      }),
    );
    assert.equal(result, true);
    assert.deepEqual(exchanged, ["valid"]);
    assert.equal(
      await Effect.runPromise(
        completeGoogleSignIn(`${target}?code=expired`, target, () =>
          Promise.resolve({ error: { message: "invalid verifier" } }),
        ),
      ),
      false,
    );
  }
});
