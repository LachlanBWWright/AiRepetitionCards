import type { Effect } from "effect";
import type { MediaId, MediaReference } from "@recall/domain";

export type LocalStoreFailure = {
  readonly _tag: "LocalStoreFailure";
  readonly operation: "read" | "write" | "clear";
};

export type WorkspaceStore = {
  readonly read: Effect.Effect<string | null, LocalStoreFailure>;
  readonly write: (serializedWorkspace: string) => Effect.Effect<void, LocalStoreFailure>;
  readonly clear: Effect.Effect<void, LocalStoreFailure>;
};

export type StoredMediaAsset = {
  readonly reference: MediaReference;
  readonly bytes: Uint8Array;
};

export type MediaStoreFailure = {
  readonly _tag: "MediaStoreFailure";
  readonly operation: "read" | "write" | "delete" | "list";
};

export type MediaStore = {
  readonly get: (id: MediaId) => Effect.Effect<StoredMediaAsset | null, MediaStoreFailure>;
  readonly put: (asset: StoredMediaAsset) => Effect.Effect<void, MediaStoreFailure>;
  readonly delete: (id: MediaId) => Effect.Effect<void, MediaStoreFailure>;
  readonly list: Effect.Effect<readonly MediaReference[], MediaStoreFailure>;
};
