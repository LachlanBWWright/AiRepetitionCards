import { Effect, Schema } from "effect";

const Email = Schema.String.pipe(
  Schema.trimmed(),
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  Schema.maxLength(320),
);

export function requestEmailSignIn(
  email: unknown,
  send: (email: string) => Promise<{ readonly error: unknown }>,
) {
  return Schema.decodeUnknown(Email)(email).pipe(
    Effect.mapError(() => "Enter a valid email address."),
    Effect.flatMap((address) =>
      Effect.tryPromise({
        try: () => send(address),
        catch: () => "Could not reach the sign-in service. Try again.",
      }),
    ),
    Effect.flatMap(({ error }) =>
      error
        ? Effect.fail("The sign-in email could not be sent. Check the address or try again later.")
        : Effect.succeed("Check your email for a sign-in link."),
    ),
  );
}
