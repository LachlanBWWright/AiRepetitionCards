import { Schema } from "effect";
export const Status = Schema.Struct({
  enabled: Schema.Boolean,
  activeClientId: Schema.NullOr(Schema.String),
  accounts: Schema.Array(
    Schema.Struct({
      clientId: Schema.String,
      label: Schema.String,
      email: Schema.NullOr(Schema.String),
      signedIn: Schema.Boolean,
      planEnabled: Schema.Boolean,
      usagePaused: Schema.optional(Schema.Boolean),
    }),
  ),
});
export const Models = Schema.Array(
  Schema.Struct({ slug: Schema.String, displayName: Schema.String }),
);
export type LocalChatGPTState = typeof Status.Type;
