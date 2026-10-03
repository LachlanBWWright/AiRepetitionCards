import { Effect } from "effect";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  exportKnowledgeAreaPackage,
  exportDelimitedCards,
  importDelimitedCards,
  exportWorkspaceBackupPackage,
  fromKnowledgeArea,
  importKnowledgeAreaPackage,
  importWorkspaceBackupPackage,
  MAX_KNOWLEDGE_AREA_PACKAGE_BYTES,
  toKnowledgeArea,
  type KnowledgeAreaExportError,
  type KnowledgeAreaImportError,
  type KnowledgeAreaPackageFailure,
  type MediaPersistenceFailure,
  type RestoredWorkspaceBackup,
} from "@recall/application";
import { parseKnowledgeAreaJson, type LearningArea, type Workspace } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";

const maxImportBytes = MAX_KNOWLEDGE_AREA_PACKAGE_BYTES;

export type NativeInterchangeFailure =
  | KnowledgeAreaExportError
  | KnowledgeAreaImportError
  | KnowledgeAreaPackageFailure
  | import("@recall/application").WorkspaceBackupFailure
  | MediaPersistenceFailure
  | {
      readonly _tag: "NativeDelimitedImportFailure";
      readonly reason: import("@recall/application").DelimitedImportError;
    }
  | {
      readonly _tag: "NativeInterchangeFailure";
      readonly reason:
        | "picker-failed"
        | "file-unavailable"
        | "file-too-large"
        | "file-read-failed"
        | "export-failed"
        | "sharing-unavailable";
    };

export type PickedKnowledgeArea = {
  readonly area: LearningArea;
  readonly media: RestoredWorkspaceBackup["media"];
};

export function pickKnowledgeArea(
  color: string,
  createId: () => string,
  format?: "csv" | "tsv",
): Effect.Effect<PickedKnowledgeArea | null, NativeInterchangeFailure> {
  return Effect.gen(function* () {
    const selected = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: format
            ? ["text/csv", "text/tab-separated-values", "text/plain", "application/octet-stream"]
            : ["application/zip", "application/json", "text/json", "text/plain"],
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "picker-failed" }) as const,
    });
    if (selected.canceled) return null;
    const asset = selected.assets[0];
    if (!asset)
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-unavailable",
      } as const);
    if (typeof asset.size === "number" && asset.size > maxImportBytes) {
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-too-large",
      } as const);
    }
    const text = yield* Effect.tryPromise({
      try: async () => {
        const file = new File(asset.uri);
        if (file.size > maxImportBytes) return null;
        if (!format && asset.name.toLowerCase().endsWith(".zip")) return file.bytes();
        return file.text();
      },
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "file-read-failed" }) as const,
    });
    if (text === null) {
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-too-large",
      } as const);
    }
    if (format) {
      if (typeof text !== "string")
        return yield* Effect.fail({
          _tag: "NativeInterchangeFailure",
          reason: "file-read-failed",
        } as const);
      const imported = importDelimitedCards(
        text,
        format === "csv" ? "," : "\t",
        asset.name.replace(/\.(csv|tsv|txt)$/i, "").slice(0, 80),
        color,
        new Date(),
        createId,
      );
      if (imported._tag === "Failure")
        return yield* Effect.fail({
          _tag: "NativeDelimitedImportFailure",
          reason: imported.reason,
        } as const);
      return { area: imported.area, media: [] };
    }
    if (asset.name.toLowerCase().endsWith(".zip")) {
      if (typeof text === "string")
        return yield* Effect.fail({
          _tag: "NativeInterchangeFailure",
          reason: "file-read-failed",
        } as const);
      const packageData = yield* importKnowledgeAreaPackage(text);
      const area = yield* fromKnowledgeArea(
        packageData.knowledgeArea,
        color,
        false,
        createId,
        new Date(),
        true,
      );
      return { area, media: packageData.media };
    }
    if (typeof text !== "string")
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-read-failed",
      } as const);
    const document = yield* parseKnowledgeAreaJson(text);
    const area = yield* fromKnowledgeArea(document, color, false, createId, new Date());
    return { area, media: [] };
  });
}

export function pickWorkspaceBackup(): Effect.Effect<
  RestoredWorkspaceBackup | null,
  NativeInterchangeFailure
> {
  return Effect.gen(function* () {
    const selected = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: ["application/zip", "application/octet-stream"],
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "picker-failed" }) as const,
    });
    if (selected.canceled) return null;
    const asset = selected.assets[0];
    if (!asset)
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-unavailable",
      } as const);
    if (typeof asset.size === "number" && asset.size > 100 * 1024 * 1024)
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-too-large",
      } as const);
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const file = new File(asset.uri);
        return file.size > 100 * 1024 * 1024 ? null : file.bytes();
      },
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "file-read-failed" }) as const,
    });
    if (!bytes)
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "file-too-large",
      } as const);
    return yield* importWorkspaceBackupPackage(bytes);
  });
}

export function shareWorkspaceBackup(
  workspace: Workspace,
  mediaStore: MediaStore,
): Effect.Effect<void, NativeInterchangeFailure> {
  return Effect.gen(function* () {
    const available = yield* Effect.tryPromise({
      try: () => Sharing.isAvailableAsync(),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "sharing-unavailable" }) as const,
    });
    if (!available)
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "sharing-unavailable",
      } as const);
    const bytes = yield* exportWorkspaceBackupPackage(
      workspace,
      new Date().toISOString(),
      mediaStore,
    );
    const file = new File(Paths.cache, "recall-private-workspace-backup.zip");
    yield* Effect.try({
      try: () => file.write(bytes),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "export-failed" }) as const,
    });
    yield* Effect.tryPromise({
      try: () =>
        Sharing.shareAsync(file.uri, {
          mimeType: "application/zip",
          dialogTitle: "Private workspace backup",
        }),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "export-failed" }) as const,
    });
  });
}

export function shareKnowledgeArea(
  area: LearningArea,
  mediaStore: MediaStore,
  format?: "csv" | "tsv",
): Effect.Effect<void, NativeInterchangeFailure> {
  return Effect.gen(function* () {
    const hasMedia = !format && area.cards.some((card) => (card.media?.length ?? 0) > 0);
    const document = yield* toKnowledgeArea(area, false, hasMedia || Boolean(format));
    const available = yield* Effect.tryPromise({
      try: () => Sharing.isAvailableAsync(),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "sharing-unavailable" }) as const,
    });
    if (!available) {
      return yield* Effect.fail({
        _tag: "NativeInterchangeFailure",
        reason: "sharing-unavailable",
      } as const);
    }
    const title =
      area.title
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "learning-area";
    const file = yield* Effect.try({
      try: () => {
        const packageFile = new File(
          Paths.cache,
          format ? `${title}.${format}` : `${title}.knowledge-area.${hasMedia ? "zip" : "json"}`,
        );
        return packageFile;
      },
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "export-failed" }) as const,
    });
    const fileContent = format
      ? new TextEncoder().encode(exportDelimitedCards(area, format === "csv" ? "," : "\t"))
      : hasMedia
        ? yield* exportKnowledgeAreaPackage(document, mediaStore)
        : new TextEncoder().encode(JSON.stringify(document, null, 2));
    yield* Effect.try({
      try: () => file.write(fileContent),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "export-failed" }) as const,
    });
    const shared = yield* Effect.tryPromise({
      try: () =>
        Sharing.shareAsync(file.uri, {
          mimeType:
            format === "csv"
              ? "text/csv"
              : format === "tsv"
                ? "text/tab-separated-values"
                : hasMedia
                  ? "application/zip"
                  : "application/json",
          dialogTitle: area.title,
        }),
      catch: () => ({ _tag: "NativeInterchangeFailure", reason: "export-failed" }) as const,
    });
    return shared;
  });
}
