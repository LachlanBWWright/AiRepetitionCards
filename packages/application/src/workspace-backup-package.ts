import { sha256 } from "@noble/hashes/sha2.js";
import { unzipSync, zipSync, type UnzipFileInfo } from "fflate";
import { Effect, Either, Schema } from "effect";
import {
  MediaReferenceSchema,
  parseWorkspaceJson,
  type MediaReference,
  type Workspace,
} from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { isSupportedMediaContent } from "./knowledge-area-package";
import { hasSafeZipExpansion } from "./zip-safety";

const maxArchiveBytes = 100_000_000;
const maxExpandedBytes = 100_000_000;
const maxFiles = 128;
const ManifestSchema = Schema.Struct({
  backupVersion: Schema.Literal(2),
  exportedAt: Schema.String,
  workspaceSha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
  media: Schema.Array(MediaReferenceSchema),
});
const IndexSchema = Schema.Array(MediaReferenceSchema);
const StaticFiles = new Set(["manifest.json", "workspace.json", "media/index.json"]);

export type WorkspaceBackupFailure = {
  readonly _tag: "WorkspaceBackupFailure";
  readonly reason: "invalid-backup" | "limits-exceeded" | "media-unavailable" | "media-mismatch";
};

export type RestoredWorkspaceBackup = {
  readonly workspace: Workspace;
  readonly media: readonly StoredMediaAsset[];
};

function failure(reason: WorkspaceBackupFailure["reason"]): WorkspaceBackupFailure {
  return { _tag: "WorkspaceBackupFailure", reason };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hash(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function referencesIn(workspace: Workspace): readonly MediaReference[] {
  const references = new Map<string, MediaReference>();
  for (const area of [...workspace.areas, ...(workspace.retainedReviewAreas ?? [])]) {
    for (const card of area.cards) {
      for (const reference of card.media ?? []) references.set(reference.id, reference);
    }
  }
  return [...references.values()];
}

function pathFor(reference: MediaReference): string {
  const extension: Record<MediaReference["mimeType"], string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
  };
  return `media/${reference.id}.${extension[reference.mimeType]}`;
}

export function exportWorkspaceBackupPackage(
  workspace: Workspace,
  exportedAt: string,
  mediaStore: MediaStore,
): Effect.Effect<Uint8Array, WorkspaceBackupFailure> {
  return Effect.gen(function* () {
    const references = referencesIn(workspace);
    const serializedWorkspace = JSON.stringify(workspace);
    const workspaceBytes = new TextEncoder().encode(serializedWorkspace);
    const indexBytes = jsonBytes(references);
    const files: Record<string, Uint8Array> = {
      "workspace.json": workspaceBytes,
      "media/index.json": indexBytes,
    };
    const manifestFiles = [
      { path: "workspace.json", sha256: hash(workspaceBytes) },
      { path: "media/index.json", sha256: hash(indexBytes) },
    ];
    let expandedBytes = workspaceBytes.byteLength + indexBytes.byteLength;
    if (references.length + 3 > maxFiles || expandedBytes > maxExpandedBytes)
      return yield* Effect.fail(failure("limits-exceeded"));
    for (const reference of references) {
      const asset = yield* mediaStore
        .get(reference.id)
        .pipe(Effect.mapError(() => failure("media-unavailable")));
      if (
        !asset ||
        asset.reference.mimeType !== reference.mimeType ||
        asset.reference.byteLength !== reference.byteLength ||
        asset.bytes.byteLength !== reference.byteLength ||
        hash(asset.bytes) !== reference.id ||
        !isSupportedMediaContent(asset.bytes, reference.mimeType)
      )
        return yield* Effect.fail(failure("media-unavailable"));
      const path = pathFor(reference);
      expandedBytes += asset.bytes.byteLength;
      if (expandedBytes > maxExpandedBytes) return yield* Effect.fail(failure("limits-exceeded"));
      files[path] = asset.bytes;
      manifestFiles.push({ path, sha256: reference.id });
    }
    const manifestBytes = jsonBytes({
      backupVersion: 2,
      exportedAt,
      workspaceSha256: hash(workspaceBytes),
      files: manifestFiles,
      media: references,
    });
    if (expandedBytes + manifestBytes.byteLength > maxExpandedBytes)
      return yield* Effect.fail(failure("limits-exceeded"));
    files["manifest.json"] = manifestBytes;
    const archive = yield* Effect.try({
      try: () => zipSync(files, { level: 6 }),
      catch: () => failure("invalid-backup"),
    });
    return archive.byteLength <= maxArchiveBytes
      ? archive
      : yield* Effect.fail(failure("limits-exceeded"));
  });
}

export function importWorkspaceBackupPackage(
  input: unknown,
): Effect.Effect<RestoredWorkspaceBackup, WorkspaceBackupFailure> {
  return Effect.gen(function* () {
    if (!(input instanceof Uint8Array) || input.byteLength > maxArchiveBytes)
      return yield* Effect.fail(failure("limits-exceeded"));
    const zipEntries = yield* Effect.try({
      try: () => {
        const entries: UnzipFileInfo[] = [];
        unzipSync(input, {
          filter: (entry) => {
            if (entries.length <= maxFiles) entries.push(entry);
            return false;
          },
        });
        return entries;
      },
      catch: () => failure("invalid-backup"),
    });
    if (!hasSafeZipExpansion(zipEntries, { maxFiles, maxExpandedBytes }))
      return yield* Effect.fail(failure("limits-exceeded"));
    let fileCount = 0;
    let expandedBytes = 0;
    const archiveState = { rejected: false };
    const seenPaths = new Set<string>();
    const files = yield* Effect.try({
      try: () =>
        unzipSync(input, {
          filter: (file) => {
            fileCount += 1;
            expandedBytes += file.originalSize;
            const path = file.name;
            const duplicatePath = seenPaths.has(path);
            seenPaths.add(path);
            const allowed =
              safePath(path) &&
              (StaticFiles.has(path) ||
                /^media\/[a-f0-9]{64}\.(jpg|png|gif|webp|mp3|ogg|wav)$/.test(path));
            if (
              duplicatePath ||
              !allowed ||
              fileCount > maxFiles ||
              expandedBytes > maxExpandedBytes
            )
              archiveState.rejected = true;
            return (
              !duplicatePath &&
              allowed &&
              fileCount <= maxFiles &&
              expandedBytes <= maxExpandedBytes
            );
          },
        }),
      catch: () => failure("invalid-backup"),
    });
    const names = Object.keys(files);
    if (archiveState.rejected || names.length !== fileCount || new Set(names).size !== names.length)
      return yield* Effect.fail(
        fileCount > maxFiles || expandedBytes > maxExpandedBytes
          ? failure("limits-exceeded")
          : failure("invalid-backup"),
      );
    const parsed = yield* Effect.try({
      try: () => ({
        manifest: JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            files["manifest.json"] ?? new Uint8Array(),
          ),
        ) as unknown,
        media: JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            files["media/index.json"] ?? new Uint8Array(),
          ),
        ) as unknown,
        workspaceText: new TextDecoder("utf-8", { fatal: true }).decode(
          files["workspace.json"] ?? new Uint8Array(),
        ),
      }),
      catch: () => failure("invalid-backup"),
    });
    const manifestResult = Schema.decodeUnknownEither(ManifestSchema)(parsed.manifest);
    const indexResult = Schema.decodeUnknownEither(IndexSchema)(parsed.media);
    if (Either.isLeft(manifestResult) || Either.isLeft(indexResult))
      return yield* Effect.fail(failure("invalid-backup"));
    const manifest = manifestResult.right;
    const references = indexResult.right;
    const workspaceBytes = files["workspace.json"];
    if (!workspaceBytes || hash(workspaceBytes) !== manifest.workspaceSha256)
      return yield* Effect.fail(failure("invalid-backup"));
    const workspace = yield* parseWorkspaceJson(parsed.workspaceText).pipe(
      Effect.mapError(() => failure("invalid-backup")),
    );
    const expectedReferences = referencesIn(workspace);
    if (
      JSON.stringify(references) !== JSON.stringify(expectedReferences) ||
      JSON.stringify(manifest.media) !== JSON.stringify(references) ||
      manifest.files.length !== names.length - 1 ||
      new Set(manifest.files.map((entry) => entry.path)).size !== manifest.files.length
    )
      return yield* Effect.fail(failure("invalid-backup"));
    for (const entry of manifest.files) {
      const content = files[entry.path];
      if (
        !safePath(entry.path) ||
        entry.path === "manifest.json" ||
        !content ||
        hash(content) !== entry.sha256
      )
        return yield* Effect.fail(failure("invalid-backup"));
    }
    const media: StoredMediaAsset[] = [];
    for (const reference of references) {
      const bytes = files[pathFor(reference)];
      if (
        !bytes ||
        bytes.byteLength !== reference.byteLength ||
        hash(bytes) !== reference.id ||
        !isSupportedMediaContent(bytes, reference.mimeType)
      )
        return yield* Effect.fail(failure("media-mismatch"));
      media.push({ reference, bytes });
    }
    if (
      names.some(
        (path) =>
          path.startsWith("media/") &&
          path !== "media/index.json" &&
          !references.some((reference) => pathFor(reference) === path),
      )
    )
      return yield* Effect.fail(failure("invalid-backup"));
    return { workspace, media };
  });
}
