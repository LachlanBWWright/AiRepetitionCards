import { sha256 } from "@noble/hashes/sha2.js";
import { Schema } from "effect";
import {
  ActivityLibrarySchema,
  MediaReferenceSchema,
  ReviewEventSchema,
  CardVersionSchema,
  LearningAreaSchema,
  type ActivityLibrary,
  type KnowledgeArea,
  type LearningArea,
  type MediaReference,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";

export const MAX_PORTABLE_DECK_PACKAGE_BYTES = 25_000_000;
export const maxFiles = 128;
export const maxExpandedBytes = 40_000_000;
const shaSchema = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const PrivateHistorySchema = Schema.Struct({
  version: Schema.Literal(1),
  currentArea: LearningAreaSchema,
  reviewEvents: Schema.Array(ReviewEventSchema),
  cardVersions: Schema.Array(CardVersionSchema),
  activityLibrary: ActivityLibrarySchema,
});
export type PortableDeckPrivateHistory = typeof PrivateHistorySchema.Type;
export const ManifestSchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  privacy: Schema.Union(Schema.Literal("public"), Schema.Literal("private")),
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: shaSchema })),
  media: Schema.Array(MediaReferenceSchema),
});
export type PortableDeckPackageFailure = {
  readonly _tag: "PortableDeckPackageFailure";
  readonly reason: "invalid-package" | "limits-exceeded" | "media-unavailable" | "media-mismatch";
};
export type PortableDeckPrivateHistoryInput = {
  readonly currentArea: typeof LearningAreaSchema.Type;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly cardVersions?: readonly (typeof CardVersionSchema.Type)[];
  readonly activityLibrary?: ActivityLibrary;
};
export type ImportedPortableDeckPackage = {
  readonly knowledgeArea: KnowledgeArea;
  readonly media: readonly StoredMediaAsset[];
  readonly privacy: "public" | "private";
  readonly privateHistory?: PortableDeckPrivateHistory;
};
export type PortableDeckRestoreCheck =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason:
        | "public-package"
        | "private-history-missing"
        | "identity-collision"
        | "invalid-private-history";
    };
export type PortableDeckAcceptanceFailure =
  | PortableDeckPackageFailure
  | {
      readonly _tag: "PortableDeckAcceptanceFailure";
      readonly reason: "private-restore-rejected" | "invalid-deck";
    };
export type AcceptedPortableDeck = {
  readonly workspace: Workspace;
  readonly media: readonly StoredMediaAsset[];
  readonly area: LearningArea;
};
export const fail = (reason: PortableDeckPackageFailure["reason"]): PortableDeckPackageFailure => ({
  _tag: "PortableDeckPackageFailure",
  reason,
});
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const digest = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
export const parseJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
export const safePath = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes(":") &&
  !path.split("/").some((part) => !part || part === "." || part === "..");
export const pathFor = (reference: MediaReference) => {
  const extensions: Record<MediaReference["mimeType"], string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
  };
  return `media/${reference.id}.${extensions[reference.mimeType]}`;
};
export const referencedMedia = (
  area: KnowledgeArea,
  versions: readonly (typeof CardVersionSchema.Type)[] = [],
) => {
  const map = new Map<string, MediaReference>();
  let mismatch = false;
  for (const card of [...area.cards, ...versions.map((version) => version.card)]) {
    for (const item of card.media ?? []) {
      const previous = map.get(item.id);
      if (
        previous &&
        (previous.mimeType !== item.mimeType || previous.byteLength !== item.byteLength)
      )
        mismatch = true;
      map.set(item.id, item);
    }
  }
  if (mismatch) return null;
  return [...map.values()];
};
export const validKnowledgeArea = (area: KnowledgeArea): boolean => {
  const objectives = new Set<string>(area.objectives.map((item) => item.id));
  const cards = new Set<string>(area.cards.map((item) => item.id));
  const activities = area.activities ?? [];
  return (
    objectives.size === area.objectives.length &&
    cards.size === area.cards.length &&
    area.objectives.every((item) => item.prerequisiteIds.every((id) => objectives.has(id))) &&
    area.cards.every((item) => item.objectiveIds.every((id) => objectives.has(id))) &&
    new Set(activities.map((item) => item.id)).size === activities.length &&
    activities.every(
      (item) => item.areaId === area.id && item.objectiveIds.every((id) => objectives.has(id)),
    )
  );
};
