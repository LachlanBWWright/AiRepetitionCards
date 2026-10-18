import { DatabaseSync } from "node:sqlite";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Effect, Either, Schema } from "effect";
import { verifyMediaAsset } from "@recall/application";
import { MediaIdSchema, MediaReferenceSchema } from "@recall/domain";
import type { MediaReference } from "@recall/domain";
import type { MediaStoreFailure, StoredMediaAsset } from "@recall/local-store";

type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };

const AssetSchema = Schema.Struct({
  reference: MediaReferenceSchema,
  bytes: Schema.Uint8ArrayFromSelf,
});
const MaxAssetBytes = 20_000_000;

function failure<T>(): DesktopReply<T> {
  return { _tag: "Failure" };
}

function validAsset(input: unknown): StoredMediaAsset | null {
  const decoded = Schema.decodeUnknownEither(AssetSchema)(input);
  if (Either.isLeft(decoded)) return null;
  if (decoded.right.bytes.byteLength > MaxAssetBytes) return null;
  return verifyMediaAsset(decoded.right) ? decoded.right : null;
}

function decodeRow(input: unknown): StoredMediaAsset | null {
  if (
    typeof input !== "object" ||
    input === null ||
    !("reference_json" in input) ||
    typeof input.reference_json !== "string" ||
    !("bytes" in input) ||
    !(input.bytes instanceof Uint8Array)
  )
    return null;
  const referenceJson = input.reference_json;
  const bytes = input.bytes;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => JSON.parse(referenceJson) as unknown,
        catch: () => "invalid",
      }),
    ),
  );
  if (Either.isLeft(parsed)) return null;
  const reference = Schema.decodeUnknownEither(MediaReferenceSchema)(parsed.right);
  if (
    Either.isLeft(reference) ||
    bytes.byteLength !== reference.right.byteLength ||
    !verifyMediaAsset({ reference: reference.right, bytes })
  ) {
    return null;
  }
  return { reference: reference.right, bytes: new Uint8Array(bytes) };
}

export function registerDesktopMediaIpc(
  database: DatabaseSync,
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle("media:get", (event, input: unknown): DesktopReply<StoredMediaAsset | null> => {
    if (!trustedSender(event)) return failure();
    const id = Schema.decodeUnknownEither(MediaIdSchema)(input);
    if (Either.isLeft(id)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const row: unknown = database
              .prepare("SELECT reference_json, bytes FROM media_assets WHERE id = ?")
              .get(id.right);
            if (row === undefined) return { _tag: "Missing" } as const;
            const asset = decodeRow(row);
            return asset?.reference.id === id.right
              ? ({ _tag: "Found", asset } as const)
              : ({ _tag: "Invalid" } as const);
          },
          catch: () => ({ _tag: "MediaReadFailure" }) as const,
        }),
      ),
    );
    if (Either.isLeft(result) || result.right._tag === "Invalid") return failure();
    return { _tag: "Success", value: result.right._tag === "Missing" ? null : result.right.asset };
  });

  ipcMain.handle("media:put", (event, input: unknown): DesktopReply<void> => {
    if (!trustedSender(event)) return failure();
    const asset = validAsset(input);
    if (!asset || asset.bytes.byteLength > MaxAssetBytes) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            database
              .prepare(
                `INSERT INTO media_assets (id, reference_json, bytes) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET reference_json = excluded.reference_json, bytes = excluded.bytes`,
              )
              .run(asset.reference.id, JSON.stringify(asset.reference), asset.bytes);
          },
          catch: () => ({ _tag: "MediaWriteFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: undefined } : failure();
  });

  ipcMain.handle("media:delete", (event, input: unknown): DesktopReply<void> => {
    if (!trustedSender(event)) return failure();
    const id = Schema.decodeUnknownEither(MediaIdSchema)(input);
    if (Either.isLeft(id)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            database.prepare("DELETE FROM media_assets WHERE id = ?").run(id.right);
          },
          catch: () => ({ _tag: "MediaDeleteFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: undefined } : failure();
  });

  ipcMain.handle("media:list", (event): DesktopReply<readonly unknown[]> => {
    if (!trustedSender(event)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const rows: unknown = database
              .prepare("SELECT reference_json, bytes FROM media_assets")
              .all();
            if (!Array.isArray(rows)) return null;
            const references: MediaReference[] = [];
            for (const row of rows) {
              const asset = decodeRow(row);
              if (!asset) return null;
              references.push(asset.reference);
            }
            return references;
          },
          catch: () => ({ _tag: "MediaListFailure" }) as const,
        }),
      ),
    );
    if (Either.isLeft(result) || result.right === null) return failure();
    return { _tag: "Success", value: result.right };
  });
}

export type { MediaStoreFailure };
