import { uncoordinatedMediaStore } from "@/features/workspace/browser-media-store";
import { createBrowserActivityServices } from "./learning/activity-client";
import { Effect, Either, Schema } from "effect";
import { emptyLibraryNotes, LibraryNotesSchema, type LibraryNotesStore } from "@recall/application";
import { volatileStorage } from "./volatile-storage";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";
import { clearBrowserReleaseDraftScope } from "@/lib/publishing/release-draft-store";

const files = new Map<string, File>();
const maxLocalNotesLength = 4_000_000;
const storageKey = (scope: string) => `recall-library-notes:${scope}`;
const durablePreferenceKey = (scope: string) => `recall-library-notes-durable:${scope}`;
const durablePreferenceChangedEvent = "recall-library-notes-durable-change";
const browserStorage = () => (typeof window === "undefined" ? null : window.localStorage);
export function subscribeDurableLibraryNotesPreference(scope: string, listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const key = durablePreferenceKey(scope);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(durablePreferenceChangedEvent, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(durablePreferenceChangedEvent, listener);
  };
}
function notifyDurablePreferenceChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(durablePreferenceChangedEvent));
  } catch {
    // Persistence succeeded; storage subscribers can refresh on their next render.
  }
}
export function readDurableLibraryNotesPreference(scope: string): boolean {
  try {
    return browserStorage()?.getItem(durablePreferenceKey(scope)) === "enabled";
  } catch {
    return false;
  }
}
export function writeDurableLibraryNotesPreference(scope: string, enabled: boolean): boolean {
  let storage: Storage | null = null;
  let previouslyEnabled = false;
  try {
    storage = browserStorage();
    if (!storage) return false;
    previouslyEnabled = storage.getItem(durablePreferenceKey(scope)) === "enabled";
    if (enabled) {
      const current = volatileStorage.getItem(storageKey(scope));
      if (current && current.length > maxLocalNotesLength) return false;
      if (current) {
        const decoded = Effect.runSync(
          Effect.either(Schema.decodeUnknown(Schema.parseJson(LibraryNotesSchema))(current)),
        );
        if (Either.isLeft(decoded)) return false;
        storage.setItem(storageKey(scope), current);
      }
      storage.setItem(durablePreferenceKey(scope), "enabled");
    } else {
      const releaseDraftsCleared = Effect.runSync(
        Effect.either(clearBrowserReleaseDraftScope(scope)),
      );
      if (Either.isLeft(releaseDraftsCleared)) return false;
      storage.removeItem(durablePreferenceKey(scope));
      storage.removeItem(storageKey(scope));
    }
    notifyDurablePreferenceChanged();
    return true;
  } catch {
    if (storage) {
      try {
        if (previouslyEnabled) storage.setItem(durablePreferenceKey(scope), "enabled");
        else storage.removeItem(durablePreferenceKey(scope));
        if (!previouslyEnabled && enabled) storage.removeItem(storageKey(scope));
      } catch {
        return false;
      }
    }
    return false;
  }
}
const failure = () =>
  ({
    _tag: "LibraryNotesFailure",
    message:
      "Drafts, activities, and card flags could not be retained. Your open draft is still here. Retry before leaving this page.",
  }) as const;
export function createBrowserLibraryNotesStore(
  scope: string,
  hosted = false,
  options: { readonly durable?: boolean } = {},
): LibraryNotesStore {
  const service = hosted ? createBrowserActivityServices(scope) : null;
  let persistenceStatus: "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted" = service
    ? "awaiting-sync"
    : "saved-locally";
  const isDurable = options.durable === true;
  const readStored = () => {
    if (!options.durable || !readDurableLibraryNotesPreference(scope))
      return volatileStorage.getItem(storageKey(scope));
    const storage = browserStorage();
    if (!storage) return undefined;
    const raw = storage.getItem(storageKey(scope));
    if (raw !== null) volatileStorage.setItem(storageKey(scope), raw);
    return raw;
  };
  const writeStored = (value: string) => {
    if (options.durable) {
      // A store can outlive the checkbox state that created it. Never let an
      // already queued write recreate data after the owner opts out.
      if (!readDurableLibraryNotesPreference(scope)) return false;
      const storage = browserStorage();
      if (!storage) return false;
      storage.setItem(storageKey(scope), value);
      volatileStorage.setItem(storageKey(scope), value);
      return true;
    } else volatileStorage.setItem(storageKey(scope), value);
    return true;
  };
  return {
    scope,
    persistenceStatus: () => persistenceStatus,
    persistenceLocation: () => (isDurable ? "device" : "tab"),
    read: coordinateLocalWrite(
      Effect.gen(function* () {
        const raw = yield* Effect.try({
          try: readStored,
          catch: failure,
        });
        if (raw === undefined) return yield* Effect.fail(failure());
        const local = yield* decodeStoredNotes(raw);
        if (!service) return local;
        const remote = yield* Effect.either(
          local.activityLibrary ? service.sync(local.activityLibrary) : service.read,
        );
        // Local work remains usable while offline. A subsequent write reports sync failure.
        if (Either.isLeft(remote)) {
          persistenceStatus = "awaiting-sync";
          return local;
        }
        const merged = { ...local, activityLibrary: remote.right };
        const didWrite = yield* Effect.try({
          try: () => writeStored(JSON.stringify(merged)),
          catch: failure,
        });
        if (!didWrite) return yield* Effect.fail(failure());
        persistenceStatus = "synchronized";
        return merged;
      }),
      failure,
    ),
    write: (input, assets = []) =>
      coordinateLocalWrite(
        Effect.gen(function* () {
          const notes = yield* Schema.decodeUnknown(LibraryNotesSchema)(input).pipe(
            Effect.mapError(failure),
          );
          yield* Effect.forEach(
            assets,
            (asset) => uncoordinatedMediaStore.put(asset).pipe(Effect.mapError(failure)),
            { discard: true },
          );
          const serialized = JSON.stringify(notes);
          if (options.durable && serialized.length > maxLocalNotesLength)
            return yield* Effect.fail(failure());
          const didWrite = yield* Effect.try({
            try: () => {
              const stored = writeStored(serialized);
              const retainedKeys = new Set(notes.drafts.map((draft) => `${scope}:${draft.key}`));
              for (const key of files.keys()) {
                if (key.startsWith(`${scope}:`) && !retainedKeys.has(key)) files.delete(key);
              }
              return stored;
            },
            catch: failure,
          });
          if (!didWrite) return yield* Effect.fail(failure());
          // Commit before the network operation so failed uploads never lose local work.
          if (service && notes.activityLibrary) {
            persistenceStatus = "awaiting-sync";
            const activityLibrary = yield* service.sync(notes.activityLibrary).pipe(
              Effect.mapError((error) => {
                const failed = activitySyncFailure(error);
                persistenceStatus = failed.recovery;
                return failed;
              }),
            );
            const syncedSerialized = JSON.stringify({ ...notes, activityLibrary });
            if (options.durable && syncedSerialized.length > maxLocalNotesLength)
              return yield* Effect.fail(failure());
            const syncedStored = yield* Effect.try({
              try: () => writeStored(syncedSerialized),
              catch: failure,
            });
            if (!syncedStored) return yield* Effect.fail(failure());
            persistenceStatus = "synchronized";
            return { ...notes, activityLibrary };
          }
          persistenceStatus = "saved-locally";
          return notes;
        }),
        failure,
      ),
  };
}
export function retainDraftFile(scope: string, key: string, file: File | null) {
  if (file) files.set(`${scope}:${key}`, file);
  else files.delete(`${scope}:${key}`);
}
export function readDraftFile(scope: string, key: string): File | null {
  return volatileStorage.getItem(storageKey(scope)) !== null
    ? (files.get(`${scope}:${key}`) ?? null)
    : null;
}
export function clearDraftFiles() {
  files.clear();
}

function decodeStoredNotes(raw: string | null) {
  if (raw === null) return Effect.succeed(emptyLibraryNotes);
  if (raw.length > maxLocalNotesLength) return Effect.fail(failure());
  return Schema.decodeUnknown(Schema.parseJson(LibraryNotesSchema))(raw).pipe(
    Effect.mapError(failure),
  );
}

function activitySyncFailure(error: { readonly reason: string; readonly message: string }) {
  const recovery: "awaiting-sync" | "conflicted" =
    error.reason === "assessment-unavailable" ? "awaiting-sync" : "conflicted";
  return {
    _tag: "LibraryNotesFailure" as const,
    message: `Your work is retained locally. ${error.message} Retry synchronization when online.`,
    recovery,
  };
}
