import { Effect, Either, Schema } from "effect";
import { KnowledgeNotebookSchema, type KnowledgeNotebook } from "@recall/application";
import type { AreaId } from "@recall/domain";

type Store = typeof import("../../mobile/src/storage/ai/native-knowledge-notebook-store");
type Entry = {
  readonly areaId: AreaId;
  readonly namespace: string;
  readonly notebook: KnowledgeNotebook;
};
const entries = new Map<string, Entry>();
const key = (areaId: AreaId, namespace: string | undefined) =>
  `${namespace ?? "knowledge-notebook"}:${areaId}`;
const failure = () => ({ _tag: "NativeKnowledgeNotebookStoreFailure" }) as const;

/** Storybook-only storage: real validation and write guards, no device SQLite. */
export const readNativeKnowledgeNotebook: Store["readNativeKnowledgeNotebook"] = (
  areaId,
  namespace,
) => Effect.sync(() => entries.get(key(areaId, namespace))?.notebook ?? null);

export const writeNativeKnowledgeNotebook: Store["writeNativeKnowledgeNotebook"] = (
  areaId,
  notebook,
  mayWrite,
  namespace,
) =>
  Effect.suspend(() => {
    const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(notebook);
    if (!mayWrite() || Either.isLeft(decoded) || decoded.right.areaId !== areaId)
      return Effect.fail(failure());
    return Effect.sync(() => {
      entries.set(key(areaId, namespace), {
        areaId,
        namespace: namespace ?? "knowledge-notebook",
        notebook: decoded.right,
      });
    });
  });

export const clearNativeKnowledgeNotebooks: Store["clearNativeKnowledgeNotebooks"] = (
  areaIds,
  mayWrite,
  namespace,
) =>
  Effect.suspend(() => {
    if (mayWrite && !mayWrite()) return Effect.fail(failure());
    return Effect.sync(() => {
      for (const [id, entry] of entries) {
        if (
          areaIds === null ||
          (areaIds.includes(entry.areaId) &&
            (namespace === undefined || entry.namespace === namespace))
        )
          entries.delete(id);
      }
    });
  });
