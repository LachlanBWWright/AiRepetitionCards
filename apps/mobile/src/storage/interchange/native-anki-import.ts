import { Effect } from "effect";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { importAnkiApkg, type AnkiImportError, type AnkiImportProposal } from "@recall/application";
import { readAnkiSqliteDatabase } from "./anki-sqlite-reader";

const maxPackageBytes = 50_000_000;

export type NativeAnkiImportFailure =
  | AnkiImportError
  | {
      readonly _tag: "NativeAnkiImportFailure";
      readonly reason: "picker-failed" | "file-unavailable" | "file-too-large" | "file-read-failed";
    };

/** Picks a legacy .apkg file and returns a validated proposal for the app's review/approval UI. */
export function pickAnkiImport(options: {
  readonly color: string;
  readonly title?: string;
  readonly createId?: () => string;
}): Effect.Effect<AnkiImportProposal | null, NativeAnkiImportFailure> {
  return Effect.gen(function* () {
    const selected = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: ["application/zip", "application/octet-stream"],
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () => ({ _tag: "NativeAnkiImportFailure", reason: "picker-failed" }) as const,
    });
    if (selected.canceled) return null;
    const asset = selected.assets[0];
    if (!asset) {
      return yield* Effect.fail({
        _tag: "NativeAnkiImportFailure",
        reason: "file-unavailable",
      } as const);
    }
    if (typeof asset.size === "number" && asset.size > maxPackageBytes) {
      return yield* Effect.fail({
        _tag: "NativeAnkiImportFailure",
        reason: "file-too-large",
      } as const);
    }
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const file = new File(asset.uri);
        return file.size > maxPackageBytes ? null : file.bytes();
      },
      catch: () => ({ _tag: "NativeAnkiImportFailure", reason: "file-read-failed" }) as const,
    });
    if (!bytes) {
      return yield* Effect.fail({
        _tag: "NativeAnkiImportFailure",
        reason: "file-too-large",
      } as const);
    }
    return yield* importAnkiApkg(bytes, { ...options, now: new Date() }, readAnkiSqliteDatabase);
  });
}
