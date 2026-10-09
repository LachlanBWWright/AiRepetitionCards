import { KnowledgeNotebookSchema, type KnowledgeNotebook } from "@recall/application";
import { Effect, Schema } from "effect";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

export type KnowledgeNotebookStorageFailure = {
  readonly _tag: "KnowledgeNotebookStorageFailure";
  readonly reason: "unavailable" | "invalid" | "stale";
  readonly message: string;
};
const failure = (
  reason: KnowledgeNotebookStorageFailure["reason"],
): KnowledgeNotebookStorageFailure => ({
  _tag: "KnowledgeNotebookStorageFailure",
  reason,
  message:
    reason === "stale"
      ? "Another view saved this knowledge notebook. Export your current work before reloading the saved record."
      : reason === "invalid"
        ? "The saved knowledge notebook could not be validated. Its data has been preserved."
        : "The knowledge notebook could not be saved or read. Your current work remains available; retry when local storage is ready.",
});

/** Private device record; the shared workspace lock fences erasure and stale writes. */
export function createBrowserKnowledgeNotebookStore(namespace: string, areaId: string) {
  const key = `recall-knowledge-notebook:${JSON.stringify([namespace, areaId])}`;
  let observed: string | null | undefined;
  const read = (): Effect.Effect<KnowledgeNotebook | null, KnowledgeNotebookStorageFailure> =>
    coordinateLocalWrite(
      Effect.gen(function* () {
        const raw = yield* Effect.try({
          try: () => volatileStorage.getItem(key),
          catch: () => failure("unavailable"),
        });
        if (raw === null) {
          observed = null;
          return null;
        }
        const parsed = yield* Effect.try({
          try: (): unknown => JSON.parse(raw),
          catch: () => failure("invalid"),
        });
        const notebook = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(parsed).pipe(
          Effect.mapError(() => failure("invalid")),
        );
        if (notebook.areaId !== areaId) return yield* Effect.fail(failure("invalid"));
        observed = raw;
        return notebook;
      }),
      () => failure("unavailable"),
    );
  const write = (input: unknown): Effect.Effect<void, KnowledgeNotebookStorageFailure> =>
    coordinateLocalWrite(
      Effect.gen(function* () {
        const notebook = yield* Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
          Effect.mapError(() => failure("invalid")),
        );
        if (notebook.areaId !== areaId) return yield* Effect.fail(failure("invalid"));
        if (observed === undefined) return yield* Effect.fail(failure("unavailable"));
        const current = yield* Effect.try({
          try: () => volatileStorage.getItem(key),
          catch: () => failure("unavailable"),
        });
        if (current !== observed) return yield* Effect.fail(failure("stale"));
        const serialized = JSON.stringify(notebook);
        yield* Effect.try({
          try: () => volatileStorage.setItem(key, serialized),
          catch: () => failure("unavailable"),
        });
        observed = serialized;
      }),
      () => failure("unavailable"),
    );
  const clear = (): Effect.Effect<void, KnowledgeNotebookStorageFailure> =>
    coordinateLocalWrite(
      Effect.gen(function* () {
        if (observed === undefined) return yield* Effect.fail(failure("unavailable"));
        const current = yield* Effect.try({
          try: () => volatileStorage.getItem(key),
          catch: () => failure("unavailable"),
        });
        if (current !== observed) return yield* Effect.fail(failure("stale"));
        yield* Effect.try({
          try: () => volatileStorage.removeItem(key),
          catch: () => failure("unavailable"),
        });
        observed = null;
      }),
      () => failure("unavailable"),
    );
  return { read, write, clear };
}
