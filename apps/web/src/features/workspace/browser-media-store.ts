import { Effect } from "effect";
import type { MediaStore, MediaStoreFailure, StoredMediaAsset } from "@recall/local-store";
import { desktopMediaStore } from "./desktop-media-store";
import { coordinateLocalWrite } from "./local-write-coordinator";

const failure = (operation: MediaStoreFailure["operation"]): MediaStoreFailure => ({
  _tag: "MediaStoreFailure",
  operation,
});

const tabAssets = new Map<string, StoredMediaAsset>();
const volatileMediaStore: MediaStore = {
  get: (id) => Effect.sync(() => tabAssets.get(id) ?? null),
  put: (asset) =>
    Effect.suspend(() =>
      asset.bytes.byteLength === asset.reference.byteLength
        ? Effect.sync(() => {
            tabAssets.set(asset.reference.id, asset);
          })
        : Effect.fail(failure("write")),
    ),
  delete: (id) => Effect.sync(() => void tabAssets.delete(id)),
  list: Effect.sync(() => [...tabAssets.values()].map((asset) => asset.reference)),
};

function hasDesktopMediaBridge(): boolean {
  return typeof window !== "undefined" && window.recallDesktop?.media !== undefined;
}

export const uncoordinatedMediaStore: MediaStore = {
  get: (id) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.get(id) : volatileMediaStore.get(id),
    ),
  put: (asset) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.put(asset) : volatileMediaStore.put(asset),
    ),
  delete: (id) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.delete(id) : volatileMediaStore.delete(id),
    ),
  list: Effect.suspend(() =>
    hasDesktopMediaBridge() ? desktopMediaStore.list : volatileMediaStore.list,
  ),
};

export const browserMediaStore: MediaStore = {
  ...uncoordinatedMediaStore,
  put: (asset) => coordinateLocalWrite(uncoordinatedMediaStore.put(asset), () => failure("write")),
  delete: (id) => coordinateLocalWrite(uncoordinatedMediaStore.delete(id), () => failure("delete")),
};
