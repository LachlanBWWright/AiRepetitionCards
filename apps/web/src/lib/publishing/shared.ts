import { createHash, randomBytes } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { expandCloze, canonicalPublicationJson, publicationContentHash } from "@recall/application";
import { PublishedKnowledgeAreaRowSchema } from "@recall/contracts";
import { KnowledgeAreaSchema } from "@recall/domain";

export const PublishedVersionSchema = PublishedKnowledgeAreaRowSchema;

export type PublishedVersion = typeof PublishedVersionSchema.Type;
export type PortableArea = typeof KnowledgeAreaSchema.Type;

export const canonicalJson = canonicalPublicationJson;
export const contentHash = publicationContentHash;

export function parsePortableArea(value: unknown): PortableArea | null {
  const decoded = Schema.decodeUnknownEither(KnowledgeAreaSchema)(value);
  if (Either.isLeft(decoded)) return null;
  const area = decoded.right;
  const ids = new Set(area.objectives.map(({ id }) => id));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(area.id) ||
    area.objectives.some(
      ({ id, prerequisiteIds }) => !uuid.test(id) || prerequisiteIds.some((id) => !ids.has(id)),
    ) ||
    area.cards.some(
      (card) =>
        !uuid.test(card.id) ||
        card.objectiveIds.some((objectiveId) => !ids.has(objectiveId)) ||
        (card.kind === "cloze" &&
          Either.isLeft(Effect.runSync(Effect.either(expandCloze(card.text, card.deletionIndex))))),
    )
  ) {
    return null;
  }
  return area;
}

export function parsePublishedVersionRow(value: unknown): PublishedVersion | null {
  const decoded = Schema.decodeUnknownEither(PublishedVersionSchema)(value);
  return Either.isLeft(decoded) ? null : decoded.right;
}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
