import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { requestEmailSignIn } from "../../../../apps/web/src/lib/auth/request-email-sign-in";

test("email sign-in rejects invalid input before contacting the provider", async () => {
  let calls = 0;
  const result = await Effect.runPromise(
    Effect.either(
      requestEmailSignIn("not-an-address", () => {
        calls += 1;
        return Promise.resolve({ error: null });
      }),
    ),
  );
  assert.equal(Either.isLeft(result), true);
  assert.equal(calls, 0);
});

test("email sign-in reports provider failures without claiming an email was sent", async () => {
  const result = await Effect.runPromise(
    Effect.either(
      requestEmailSignIn("person@example.com", () =>
        Promise.resolve({ error: { code: "email_address_not_authorized" } }),
      ),
    ),
  );
  assert.equal(Either.isLeft(result), true);
});

test("email sign-in confirms a successful provider request", async () => {
  const result = await Effect.runPromise(
    Effect.either(requestEmailSignIn("person@example.com", () => Promise.resolve({ error: null }))),
  );
  assert.equal(Either.isRight(result), true);
});
