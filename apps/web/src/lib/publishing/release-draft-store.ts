import { Effect } from "effect";
import type { ReleaseDraftStore } from "@recall/application";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

type DraftStorage = {
  readonly length: number;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
  readonly key: (index: number) => string | null;
};

const key = (id: string) => `recall-release-draft:${id}`;
const scopePrefix = (id: string) => {
  const separator = id.indexOf("--");
  return `recall-release-draft:${separator < 0 ? "local" : id.slice(0, separator)}--`;
};
const failure = () => ({ _tag: "ReleaseDraftStorageFailure" }) as const;
export function releaseDraftStoragePrefix(scope: string): string {
  const sanitized =
    scope
      .trim()
      .replace(/[^A-Za-z0-9.-]/g, "_")
      .slice(0, 120) || "local";
  return `recall-release-draft:${sanitized}--`;
}
function prune(storage: DraftStorage, scope: string, current: string): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (value): value is string => value?.startsWith(scope) === true,
  );
  let total = keys.reduce((sum, item) => sum + (storage.getItem(item)?.length ?? 0), 0);
  let count = keys.length;
  for (const item of keys) {
    if (count <= 100 && total <= 4_000_000) break;
    if (item === current) continue;
    total -= storage.getItem(item)?.length ?? 0;
    storage.removeItem(item);
    count -= 1;
  }
}

export function clearBrowserReleaseDraftScope(
  scope: string,
): Effect.Effect<void, { readonly _tag: "ReleaseDraftStorageFailure" }> {
  return coordinateLocalWrite(
    Effect.try({
      try: () => {
        const prefix = releaseDraftStoragePrefix(scope);
        const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
          window.localStorage.key(index),
        ).filter((value): value is string => value?.startsWith(prefix) === true);
        for (const item of keys) window.localStorage.removeItem(item);
      },
      catch: failure,
    }),
    failure,
  );
}

/** Choose tab memory by default; callers opt into durable local storage explicitly. */
export function createBrowserReleaseDraftStore(
  retainOnDevice: boolean,
  isRetentionEnabled: () => boolean = () => retainOnDevice,
): ReleaseDraftStore {
  const durableStorage: DraftStorage = {
    get length() {
      return window.localStorage.length;
    },
    getItem: (storageKey) => window.localStorage.getItem(storageKey),
    setItem: (storageKey, value) => {
      window.localStorage.setItem(storageKey, value);
    },
    removeItem: (storageKey) => {
      window.localStorage.removeItem(storageKey);
    },
    key: (index) => window.localStorage.key(index),
  };
  const storage = () => (retainOnDevice && isRetentionEnabled() ? durableStorage : volatileStorage);
  return {
    read: (id) =>
      coordinateLocalWrite(
        Effect.try({ try: () => storage().getItem(key(id)), catch: failure }),
        failure,
      ),
    write: (id, value) =>
      coordinateLocalWrite(
        Effect.try({
          try: () => {
            const selectedStorage = storage();
            const storageKey = key(id);
            selectedStorage.setItem(storageKey, value);
            prune(selectedStorage, scopePrefix(id), storageKey);
          },
          catch: failure,
        }),
        failure,
      ),
    clear: (id) =>
      coordinateLocalWrite(
        Effect.try({
          try: () => {
            storage().removeItem(key(id));
          },
          catch: failure,
        }),
        failure,
      ),
  };
}
