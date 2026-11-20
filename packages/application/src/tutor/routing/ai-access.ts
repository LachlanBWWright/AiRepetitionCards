import { Effect, Schema } from "effect";

export const AiAccessSelectionSchema = Schema.Literal("byo", "managed");
export type AiAccessSelection = typeof AiAccessSelectionSchema.Type;

const Identifier = Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]{0,63}$/));
const Timestamp = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const AccessState = Schema.Struct({
  accountId: Schema.NullOr(Schema.UUID),
  byoReady: Schema.Boolean,
  now: Timestamp,
  managedGrant: Schema.NullOr(
    Schema.Struct({
      accountId: Schema.UUID,
      expiresAt: Timestamp,
      deploymentIds: Schema.Array(Identifier).pipe(Schema.minItems(1), Schema.maxItems(100)),
    }),
  ),
});
export type AiAccessFailure = {
  readonly _tag: "AiAccessFailure";
  readonly reason:
    | "invalid-access-state"
    | "selection-required"
    | "byo-unavailable"
    | "sign-in-required"
    | "managed-not-entitled";
};
export type AiAccessDecision =
  | { readonly mode: "byo" }
  | {
      readonly mode: "managed";
      readonly accountId: string;
      readonly deploymentIds: readonly string[];
    };
const failure = (reason: AiAccessFailure["reason"]): AiAccessFailure => ({
  _tag: "AiAccessFailure",
  reason,
});

/** Call with verified identity/grants, never client assertions. Availability never changes funding. */
export function resolveAiAccess(
  selection: unknown,
  state: unknown,
): Effect.Effect<AiAccessDecision, AiAccessFailure> {
  return Effect.gen(function* () {
    const mode = yield* Schema.decodeUnknown(AiAccessSelectionSchema)(selection).pipe(
      Effect.mapError(() => failure("selection-required")),
    );
    const access = yield* Schema.decodeUnknown(AccessState)(state).pipe(
      Effect.mapError(() => failure("invalid-access-state")),
    );
    if (mode === "byo") {
      if (!access.byoReady) return yield* Effect.fail(failure("byo-unavailable"));
      return { mode };
    }
    if (!access.accountId) return yield* Effect.fail(failure("sign-in-required"));
    const grant = access.managedGrant;
    if (
      !grant ||
      grant.accountId !== access.accountId ||
      grant.expiresAt <= access.now ||
      new Set(grant.deploymentIds).size !== grant.deploymentIds.length
    )
      return yield* Effect.fail(failure("managed-not-entitled"));
    return { mode, accountId: access.accountId, deploymentIds: grant.deploymentIds };
  });
}
