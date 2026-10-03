import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Either, Schema } from "effect";
import { decodeAndMigrateKnowledgeArea, type KnowledgeArea } from "@recall/domain";
import {
  PublicationForkOperationIdSchema,
  PublicationVersionIdSchema,
  PublishKnowledgeAreaRequestSchema,
} from "@recall/contracts";

export type PublicationPreparationFailure = {
  readonly _tag: "PublicationPreparationFailure";
  readonly reason: "invalid-request" | "lineage-mismatch" | "rights-required";
};

export function publicationNeedsReuseConfirmation(
  content: KnowledgeArea,
  license: string | null,
): boolean {
  return (
    !content.licence ||
    license !== content.licence ||
    Boolean(content.sourceId || content.forkedFromVersionId) ||
    content.cards.some((card) => card.origin === "imported")
  );
}

export function preparePublication(input: unknown) {
  return Effect.gen(function* () {
    const parsed = Schema.decodeUnknownEither(PublishKnowledgeAreaRequestSchema)(input);
    if (Either.isLeft(parsed))
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "invalid-request",
      } as const);
    const request = parsed.right;
    const sourceIdentity = Schema.decodeUnknownEither(PublicationForkOperationIdSchema)(
      request.sourceAreaId,
    );
    const contentIdentity = Schema.decodeUnknownEither(PublicationForkOperationIdSchema)(
      request.content.id,
    );
    if ((request.visibility === "unlisted") !== (request.shareToken !== undefined))
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "invalid-request",
      } as const);
    const parsedLineage = Schema.decodeUnknownEither(Schema.NullOr(PublicationVersionIdSchema))(
      request.content.forkedFromVersionId ?? null,
    );
    if (Either.isLeft(parsedLineage))
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "invalid-request",
      } as const);
    const contentLineage = parsedLineage.right;
    if (request.forkedFromVersionId !== undefined && request.forkedFromVersionId !== contentLineage)
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "lineage-mismatch",
      } as const);
    const license = request.license?.trim() || request.content.licence?.trim() || null;
    const attribution = request.attribution?.trim() || request.content.attribution?.trim() || null;
    if (
      request.visibility !== "private" &&
      (!license ||
        (publicationNeedsReuseConfirmation(request.content, license) &&
          request.reuseConfirmed !== true))
    )
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "rights-required",
      } as const);
    const normalized = {
      ...request,
      sourceAreaId: Either.isRight(sourceIdentity) ? sourceIdentity.right : request.sourceAreaId,
      license,
      attribution,
      forkedFromVersionId: contentLineage,
      content: {
        ...request.content,
        id: Either.isRight(contentIdentity) ? contentIdentity.right : request.content.id,
        licence: license,
        attribution,
        ...(contentLineage === null ? {} : { forkedFromVersionId: contentLineage }),
      },
    };
    const validated = Schema.decodeUnknownEither(PublishKnowledgeAreaRequestSchema)(normalized);
    if (Either.isLeft(validated))
      return yield* Effect.fail({
        _tag: "PublicationPreparationFailure",
        reason: "invalid-request",
      } as const);
    return {
      ...validated.right,
      license,
      attribution,
      forkedFromVersionId: contentLineage,
    } as const;
  });
}

export type PublicationForkFailure = { readonly _tag: "PublicationForkFailure" };
const ForkIdentityInput = Schema.Struct({
  ownerId: PublicationForkOperationIdSchema,
  operationId: PublicationForkOperationIdSchema,
  sourceVersionId: PublicationVersionIdSchema,
});

/** Strong deterministic IDs bind retries to this owner, source and operation. */
export function publicationForkIdentity(input: unknown) {
  const parsed = Schema.decodeUnknownEither(ForkIdentityInput)(input);
  if (Either.isLeft(parsed)) return Effect.fail({ _tag: "PublicationForkFailure" } as const);
  const id = (kind: string, sourceId = "") => {
    const seed = JSON.stringify([
      "recall-publication-fork-v1",
      parsed.right.ownerId,
      parsed.right.sourceVersionId,
      parsed.right.operationId,
      kind,
      sourceId,
    ]);
    const hex = Array.from(sha256(new TextEncoder().encode(seed)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const variant = (8 + (Number.parseInt(hex[16] ?? "0", 16) & 3)).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return Effect.succeed({
    ...parsed.right,
    id,
    areaId: id("area"),
    initialVersionId: id("initial-version"),
  });
}

export function createPublicationFork(input: {
  readonly ownerId: string;
  readonly operationId: string;
  readonly sourceVersionId: string;
  readonly source: KnowledgeArea;
  readonly attribution: string | null;
  readonly license: string | null;
}) {
  return Effect.gen(function* () {
    const identity = yield* publicationForkIdentity(input);
    const objectives = new Map(
      input.source.objectives.map((objective) => [
        objective.id,
        identity.id("objective", objective.id),
      ]),
    );
    const document = yield* decodeAndMigrateKnowledgeArea({
      ...input.source,
      id: identity.areaId,
      sourceId: input.source.sourceId ?? input.source.id,
      attribution: input.attribution ?? input.source.attribution ?? null,
      licence: input.license ?? input.source.licence,
      forkedFromVersionId: identity.sourceVersionId,
      objectives: input.source.objectives.map((objective) => ({
        ...objective,
        id: objectives.get(objective.id),
        sourceId: objective.sourceId ?? objective.id,
        prerequisiteIds: objective.prerequisiteIds.map((id) => objectives.get(id)),
      })),
      cards: input.source.cards.map((card) => ({
        ...card,
        id: identity.id("card", card.id),
        sourceId: card.sourceId ?? card.id,
        objectiveIds: card.objectiveIds.map((id) => objectives.get(id)),
      })),
    }).pipe(Effect.mapError(() => ({ _tag: "PublicationForkFailure" }) as const));
    return { ...identity, document };
  });
}

export type PublicationForkOperationFailure = { readonly _tag: "PublicationForkOperationFailure" };
export type PublicationForkOperationStore = {
  readonly read: (
    versionId: string,
  ) => Effect.Effect<string | null, PublicationForkOperationFailure>;
  readonly write: (
    versionId: string,
    operationId: string,
  ) => Effect.Effect<void, PublicationForkOperationFailure>;
  readonly clear: (versionId: string) => Effect.Effect<void, PublicationForkOperationFailure>;
};
export function pendingPublicationForkOperation(
  store: PublicationForkOperationStore,
  versionId: unknown,
  createId: () => string,
) {
  return Effect.gen(function* () {
    const version = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
    if (Either.isLeft(version))
      return yield* Effect.fail({ _tag: "PublicationForkOperationFailure" } as const);
    const saved = yield* store.read(version.right);
    const candidate =
      saved ??
      (yield* Effect.try({
        try: createId,
        catch: () => ({ _tag: "PublicationForkOperationFailure" }) as const,
      }));
    const operation = Schema.decodeUnknownEither(PublicationForkOperationIdSchema)(candidate);
    if (Either.isLeft(operation))
      return yield* Effect.fail({ _tag: "PublicationForkOperationFailure" } as const);
    if (saved !== operation.right) yield* store.write(version.right, operation.right);
    return operation.right;
  });
}
