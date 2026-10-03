import { sha256 } from "@noble/hashes/sha2.js";
import { zipSync, unzipSync } from "fflate";
import { Effect, Either, Schema } from "effect";
import {
  KnowledgeAreaSchema,
  MediaReferenceSchema,
  type KnowledgeArea,
  type MediaReference,
} from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";

const maxArchiveBytes = 25_000_000;
const maxFiles = 128;
const maxExpandedBytes = 40_000_000;
const PackageManifestSchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  exporter: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
  media: Schema.Array(MediaReferenceSchema),
});
const MediaIndexSchema = Schema.Array(MediaReferenceSchema);
const allowedStaticPaths = new Set([
  "manifest.json",
  "knowledge-area.json",
  "cards.json",
  "media/index.json",
]);

export type KnowledgeAreaPackageFailure = {
  readonly _tag: "KnowledgeAreaPackageFailure";
  readonly reason: "invalid-package" | "limits-exceeded" | "media-unavailable" | "media-mismatch";
};

export type ImportedKnowledgeAreaPackage = {
  readonly knowledgeArea: KnowledgeArea;
  readonly media: readonly StoredMediaAsset[];
};

function failure(reason: KnowledgeAreaPackageFailure["reason"]): KnowledgeAreaPackageFailure {
  return { _tag: "KnowledgeAreaPackageFailure", reason };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function digest(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function isSupportedMediaContent(
  bytes: Uint8Array,
  mimeType: MediaReference["mimeType"],
): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  switch (mimeType) {
    case "image/png":
      return bytes.length >= 8 && bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "image/webp":
      return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "audio/wav":
      return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/mpeg":
      return (
        ascii(0, 3) === "ID3" ||
        (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
      );
  }
}

export function verifyMediaAsset(asset: StoredMediaAsset): boolean {
  return (
    asset.bytes.byteLength === asset.reference.byteLength &&
    digest(asset.bytes) === asset.reference.id &&
    isSupportedMediaContent(asset.bytes, asset.reference.mimeType)
  );
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !path.includes(":")
  );
}

function mediaPath(reference: MediaReference): string {
  const extensionByMime: Record<MediaReference["mimeType"], string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
  };
  return `media/${reference.id}.${extensionByMime[reference.mimeType]}`;
}

function referencedMedia(document: KnowledgeArea): readonly MediaReference[] {
  const unique = new Map<string, MediaReference>();
  for (const card of document.cards) {
    for (const reference of card.media ?? []) unique.set(reference.id, reference);
  }
  return [...unique.values()];
}

export function exportKnowledgeAreaPackage(
  document: KnowledgeArea,
  mediaStore: MediaStore,
): Effect.Effect<Uint8Array, KnowledgeAreaPackageFailure> {
  return Effect.gen(function* () {
    const references = referencedMedia(document);
    const archiveFiles: Record<string, Uint8Array> = {};
    const content = {
      "knowledge-area.json": jsonBytes(document),
      "cards.json": jsonBytes(document.cards),
      "media/index.json": jsonBytes(references),
    };
    for (const [path, bytes] of Object.entries(content)) archiveFiles[path] = bytes;
    const files: { path: string; sha256: string }[] = Object.entries(content).map(
      ([path, bytes]) => ({ path, sha256: digest(bytes) }),
    );
    for (const reference of references) {
      const asset = yield* mediaStore
        .get(reference.id)
        .pipe(Effect.mapError(() => failure("media-unavailable")));
      if (
        !asset ||
        asset.reference.mimeType !== reference.mimeType ||
        asset.bytes.byteLength !== reference.byteLength ||
        digest(asset.bytes) !== reference.id ||
        !isSupportedMediaContent(asset.bytes, reference.mimeType)
      ) {
        return yield* Effect.fail(failure("media-unavailable"));
      }
      const path = mediaPath(reference);
      archiveFiles[path] = asset.bytes;
      files.push({ path, sha256: reference.id });
    }
    const manifest = {
      formatVersion: 1,
      exporter: "Recall",
      files,
      media: references,
    };
    archiveFiles["manifest.json"] = jsonBytes(manifest);
    const zipped = yield* Effect.try({
      try: () => zipSync(archiveFiles, { level: 6 }),
      catch: () => failure("invalid-package"),
    });
    if (zipped.byteLength > maxArchiveBytes) return yield* Effect.fail(failure("limits-exceeded"));
    return zipped;
  });
}

export function importKnowledgeAreaPackage(
  input: unknown,
): Effect.Effect<ImportedKnowledgeAreaPackage, KnowledgeAreaPackageFailure> {
  return Effect.gen(function* () {
    if (!(input instanceof Uint8Array) || input.byteLength > maxArchiveBytes) {
      return yield* Effect.fail(failure("limits-exceeded"));
    }
    let fileCount = 0;
    let expandedBytes = 0;
    const files = yield* Effect.try({
      try: () =>
        unzipSync(input, {
          filter: (entry) => {
            fileCount += 1;
            expandedBytes += entry.originalSize;
            if (fileCount > maxFiles || expandedBytes > maxExpandedBytes) {
              return false;
            }
            const path = entry.name;
            return (
              validPath(path) &&
              (allowedStaticPaths.has(path) ||
                /^media\/[a-f0-9]{64}\.(jpg|png|gif|webp|mp3|ogg|wav)$/.test(path))
            );
          },
        }),
      catch: () => failure("invalid-package"),
    });
    const names = Object.keys(files);
    if (fileCount > maxFiles || expandedBytes > maxExpandedBytes)
      return yield* Effect.fail(failure("limits-exceeded"));
    if (names.length !== fileCount || names.some((name) => !(name in files))) {
      return yield* Effect.fail(failure("invalid-package"));
    }
    const parsed = yield* Effect.try({
      try: () => ({
        manifest: parseJson(files["manifest.json"] ?? new Uint8Array()),
        document: parseJson(files["knowledge-area.json"] ?? new Uint8Array()),
        index: parseJson(files["media/index.json"] ?? new Uint8Array()),
        cards: parseJson(files["cards.json"] ?? new Uint8Array()),
      }),
      catch: () => failure("invalid-package"),
    });
    const manifestResult = Schema.decodeUnknownEither(PackageManifestSchema)(parsed.manifest);
    const documentResult = Schema.decodeUnknownEither(KnowledgeAreaSchema)(parsed.document);
    const indexResult = Schema.decodeUnknownEither(MediaIndexSchema)(parsed.index);
    if (
      Either.isLeft(manifestResult) ||
      Either.isLeft(documentResult) ||
      Either.isLeft(indexResult)
    )
      return yield* Effect.fail(failure("invalid-package"));
    const manifest = manifestResult.right;
    const knowledgeArea = documentResult.right;
    const references = indexResult.right;
    const cardsResult = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(parsed.cards);
    if (
      Either.isLeft(cardsResult) ||
      JSON.stringify(cardsResult.right) !== JSON.stringify(knowledgeArea.cards)
    ) {
      return yield* Effect.fail(failure("invalid-package"));
    }
    if (
      new Set(names).size !== names.length ||
      new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length ||
      manifest.files.length !== names.length - 1 ||
      JSON.stringify(references) !== JSON.stringify(referencedMedia(knowledgeArea)) ||
      JSON.stringify(manifest.media) !== JSON.stringify(references)
    )
      return yield* Effect.fail(failure("invalid-package"));
    for (const file of manifest.files) {
      const content = files[file.path];
      if (
        !validPath(file.path) ||
        file.path === "manifest.json" ||
        !content ||
        digest(content) !== file.sha256
      ) {
        return yield* Effect.fail(failure("invalid-package"));
      }
    }
    const media: StoredMediaAsset[] = [];
    for (const reference of references) {
      const bytes = files[mediaPath(reference)];
      if (
        !bytes ||
        bytes.byteLength !== reference.byteLength ||
        digest(bytes) !== reference.id ||
        !isSupportedMediaContent(bytes, reference.mimeType)
      ) {
        return yield* Effect.fail(failure("media-mismatch"));
      }
      media.push({ reference, bytes });
    }
    if (
      names.some(
        (name) =>
          name.startsWith("media/") &&
          name !== "media/index.json" &&
          !media.some((asset) => mediaPath(asset.reference) === name),
      )
    )
      return yield* Effect.fail(failure("invalid-package"));
    return { knowledgeArea, media };
  });
}
