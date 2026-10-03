import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Schema } from "effect";
import {
  PublicationForkOperationIdSchema,
  PublishedShareTokenSchema,
  type PublishKnowledgeAreaRequest,
} from "@recall/contracts";
import { preparePublication, type PublicationForkOperationStore } from "./publication-fork";

export type PublicationOperationStore = PublicationForkOperationStore & {
  readonly coordinate?: <A, E>(
    areaId: string,
    operation: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | { readonly _tag: "PublicationForkOperationFailure" }>;
};
const attempts = Effect.runSync(Effect.makeSemaphore(1));
const PendingSchema = Schema.Struct({
  operationId: PublicationForkOperationIdSchema,
  fingerprint: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  shareToken: Schema.NullOr(PublishedShareTokenSchema),
});
export type PublicationOperationFailure = {
  readonly _tag: "PublicationOperationFailure";
  readonly reason: "storage" | "conflict" | "invalid-request";
};
export function encodePublicationShareToken(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet.charAt((buffer >>> bits) & 63);
    }
  }
  if (bits > 0) result += alphabet.charAt((buffer << (6 - bits)) & 63);
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
const hash = (value: unknown) =>
  Array.from(sha256(new TextEncoder().encode(canonical(value))), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** Content and publishing metadata bind one immutable attempt; capability proofs stay private. */
export function publicationRequestFingerprint(request: PublishKnowledgeAreaRequest): string {
  return hash({
    sourceAreaId: request.sourceAreaId,
    content: request.content,
    visibility: request.visibility,
    attribution: request.attribution ?? null,
    license: request.license ?? null,
    forkedFromVersionId: request.forkedFromVersionId ?? null,
  });
}
export function publicationOperationIdentity(
  ownerId: unknown,
  request: PublishKnowledgeAreaRequest,
) {
  return Schema.decodeUnknown(
    Schema.Struct({
      ownerId: PublicationForkOperationIdSchema,
      sourceAreaId: PublicationForkOperationIdSchema,
      operationId: PublicationForkOperationIdSchema,
    }),
  )({ ownerId, sourceAreaId: request.sourceAreaId, operationId: request.operationId }).pipe(
    Effect.map((identity) => {
      const hex = hash([
        "recall-publication-operation-v1",
        identity.ownerId,
        identity.sourceAreaId,
        identity.operationId,
      ]);
      const variant = (8 + (Number.parseInt(hex[16] ?? "0", 16) & 3)).toString(16);
      return {
        versionId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
        fingerprint: publicationRequestFingerprint(request),
      };
    }),
  );
}

export function pendingPublicationOperation(
  store: PublicationOperationStore,
  input: Omit<PublishKnowledgeAreaRequest, "operationId" | "shareToken" | "forkedFromVersionId"> & {
    readonly forkedFromVersionId?: string | null;
  },
  createId: () => string,
  createToken: () => string,
) {
  const operation = Effect.gen(function* () {
    const raw = yield* store
      .read(input.sourceAreaId)
      .pipe(
        Effect.mapError(
          () => ({ _tag: "PublicationOperationFailure", reason: "storage" }) as const,
        ),
      );
    const saved =
      raw === null
        ? null
        : yield* Effect.try({
            try: () => JSON.parse(raw) as unknown,
            catch: () => ({ _tag: "PublicationOperationFailure", reason: "storage" }) as const,
          }).pipe(
            Effect.flatMap(Schema.decodeUnknown(PendingSchema)),
            Effect.mapError(
              () => ({ _tag: "PublicationOperationFailure", reason: "storage" }) as const,
            ),
          );
    const candidate =
      saved ??
      (yield* Effect.try({
        try: () => ({
          operationId: createId(),
          shareToken: input.visibility === "unlisted" ? createToken() : null,
        }),
        catch: () => ({ _tag: "PublicationOperationFailure", reason: "storage" }) as const,
      }));
    const request = yield* preparePublication({
      ...input,
      operationId: candidate.operationId,
      ...(candidate.shareToken ? { shareToken: candidate.shareToken } : {}),
    }).pipe(
      Effect.mapError(
        () => ({ _tag: "PublicationOperationFailure", reason: "invalid-request" }) as const,
      ),
    );
    const fingerprint = publicationRequestFingerprint(request);
    if (saved && saved.fingerprint !== fingerprint)
      return yield* Effect.fail({
        _tag: "PublicationOperationFailure",
        reason: "conflict",
      } as const);
    if (!saved)
      yield* store
        .write(
          input.sourceAreaId,
          JSON.stringify({
            operationId: request.operationId,
            fingerprint,
            shareToken: candidate.shareToken,
          }),
        )
        .pipe(
          Effect.mapError(
            () => ({ _tag: "PublicationOperationFailure", reason: "storage" }) as const,
          ),
        );
    return request;
  });
  return (
    store.coordinate
      ? store.coordinate(input.sourceAreaId, operation)
      : attempts.withPermits(1)(operation)
  ).pipe(
    Effect.mapError((error) =>
      error._tag === "PublicationForkOperationFailure"
        ? ({ _tag: "PublicationOperationFailure", reason: "storage" } as const)
        : error,
    ),
  );
}
