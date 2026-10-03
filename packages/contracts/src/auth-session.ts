import { Schema } from "effect";

/** Public session status only; credentials and provider identities remain server-side. */
export const AuthSessionResponseSchema = Schema.Union(
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    authenticated: Schema.Literal(false),
    displayLabel: Schema.Null,
    ownerId: Schema.Null,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    authenticated: Schema.Literal(true),
    displayLabel: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(320)),
    ownerId: Schema.String.pipe(
      Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    ),
  }),
);

export type AuthSessionResponse = typeof AuthSessionResponseSchema.Type;
