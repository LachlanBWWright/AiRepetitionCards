import { createBrowserActivityServices } from "./learning/activity-client";
import { Effect, Either, Schema } from "effect";
import { emptyLibraryNotes, LibraryNotesSchema, type LibraryNotesStore } from "@recall/application";
import { volatileStorage } from "./volatile-storage";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";

const files = new Map<string, File>();
const storageKey = (scope: string) => `recall-library-notes:${scope}`;
const failure = () =>
  ({
    _tag: "LibraryNotesFailure",
    message:
      "Drafts, activities, and card flags could not be retained. Your open draft is still here. Retry before leaving this page.",
  }) as const;
export function createBrowserLibraryNotesStore(scope: string, hosted = false): LibraryNotesStore {
  const service = hosted ? createBrowserActivityServices(scope) : null;
  return {
    scope,
    read: coordinateLocalWrite(
      Effect.gen(function* () {
        const raw = yield* Effect.try({
          try: () => volatileStorage.getItem(storageKey(scope)),
          catch: failure,
        });
        const local =
          raw === null
            ? emptyLibraryNotes
            : yield* Schema.decodeUnknown(Schema.parseJson(LibraryNotesSchema))(raw).pipe(
                Effect.mapError(failure),
              );
        if (!service) return local;
        const remote = yield* Effect.either(
          local.activityLibrary ? service.sync(local.activityLibrary) : service.read,
        );
        // Local work remains usable while offline. A subsequent write reports sync failure.
        if (Either.isLeft(remote)) return local;
        const merged = { ...local, activityLibrary: remote.right };
        yield* Effect.try({
          try: () => volatileStorage.setItem(storageKey(scope), JSON.stringify(merged)),
          catch: failure,
        });
        return merged;
      }),
      failure,
    ),
    write: (input) =>
      coordinateLocalWrite(
        Effect.gen(function* () {
          const notes = yield* Schema.decodeUnknown(LibraryNotesSchema)(input).pipe(
            Effect.mapError(failure),
          );
          yield* Effect.try({
            try: () => {
              volatileStorage.setItem(storageKey(scope), JSON.stringify(notes));
              const retainedKeys = new Set(notes.drafts.map((draft) => `${scope}:${draft.key}`));
              for (const key of files.keys()) {
                if (key.startsWith(`${scope}:`) && !retainedKeys.has(key)) files.delete(key);
              }
            },
            catch: failure,
          });
          // Commit before the network operation so failed uploads never lose local work.
          if (service && notes.activityLibrary) {
            const activityLibrary = yield* service.sync(notes.activityLibrary).pipe(
              Effect.mapError((error) => ({
                _tag: "LibraryNotesFailure" as const,
                message: `Your work is retained in this tab. ${error.message} Retry synchronization before closing the tab.`,
              })),
            );
            yield* Effect.try({
              try: () =>
                volatileStorage.setItem(
                  storageKey(scope),
                  JSON.stringify({ ...notes, activityLibrary }),
                ),
              catch: failure,
            });
            return { ...notes, activityLibrary };
          }
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
