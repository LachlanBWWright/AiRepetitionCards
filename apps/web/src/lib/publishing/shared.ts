import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Either, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";

export const PublishedVersionSchema = Schema.Struct({
  id: Schema.String,
  source_area_id: Schema.NullOr(Schema.String),
  owner_id: Schema.NullOr(Schema.String),
  version: Schema.Number,
  content: Schema.Unknown,
  content_hash: Schema.String,
  visibility: Schema.Union(
    Schema.Literal("private"),
    Schema.Literal("unlisted"),
    Schema.Literal("public"),
  ),
  attribution: Schema.NullOr(Schema.String),
  license: Schema.NullOr(Schema.String),
  forked_from_version_id: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});

export type PublishedVersion = typeof PublishedVersionSchema.Type;
export type PortableArea = typeof KnowledgeAreaSchema.Type;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function contentHash(content: PortableArea): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

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
        !uuid.test(card.id) || card.objectiveIds.some((objectiveId) => !ids.has(objectiveId)),
    )
  ) {
    return null;
  }
  return area;
}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function forkPortableArea(area: PortableArea): PortableArea | null {
  const objectiveIds = new Map(area.objectives.map(({ id }) => [id, randomUUID()]));
  return parsePortableArea({
    ...area,
    id: randomUUID(),
    objectives: area.objectives.map((objective) => ({
      ...objective,
      id: objectiveIds.get(objective.id) ?? randomUUID(),
      prerequisiteIds: objective.prerequisiteIds.map((id) => objectiveIds.get(id) ?? id),
    })),
    cards: area.cards.map((card) => ({
      ...card,
      id: randomUUID(),
      objectiveIds: card.objectiveIds.map((id) => objectiveIds.get(id) ?? id),
    })),
  });
}
