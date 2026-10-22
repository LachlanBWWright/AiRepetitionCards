import { readStudyPages, writeStudyBatches } from "./study-pages";
import { validateStudySettings } from "../../review/presets/validate-settings";
import { Effect, Schema } from "effect";
import { StudySyncDocumentSchema, type StudySyncDocument, type Workspace } from "@recall/domain";
import type { WorkspaceSyncFailure } from "./workspace-sync";

export const emptyStudyDocument = (): StudySyncDocument => ({
  settings: { requestRetention: 0.9 },
  adjustments: [],
  corrections: [],
  undoStates: [],
});
export function workspaceStudyDocument(workspace: Workspace): StudySyncDocument {
  return {
    importedSchedules: [
      ...new Map(
        [
          ...[...workspace.areas, ...(workspace.retainedReviewAreas ?? [])].flatMap((area) =>
            area.cards.flatMap((card) =>
              card.importedSchedule
                ? [{ areaId: area.id, cardId: card.id, baseline: card.importedSchedule }]
                : [],
            ),
          ),
          ...(workspace.importedScheduleBaselines ?? []),
        ].map((item) => [item.cardId, item]),
      ).values(),
    ],
    settings: workspace.schedulerSettings ?? { requestRetention: 0.9 },
    adjustments: workspace.scheduleAdjustments ?? [],
    corrections: workspace.reviewCorrections ?? [],
    undoStates: workspace.reviewUndoStates ?? [],
  };
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
};
const failure = (conflict = false): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason: conflict ? "study-conflict" : "study-settings",
});
/** Three-way field merge: independent settings merge; overlapping edits require resolution. */
export function mergeStudyDocuments(
  base: StudySyncDocument,
  local: StudySyncDocument,
  remote: StudySyncDocument,
): Effect.Effect<StudySyncDocument, WorkspaceSyncFailure> {
  return Effect.gen(function* () {
    const settings: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base.settings),
      ...Object.keys(local.settings),
      ...Object.keys(remote.settings),
    ])) {
      const get = (document: StudySyncDocument): unknown =>
        Object.entries(document.settings).find(([name]) => name === key)?.[1];
      const original = get(base),
        ours = get(local),
        theirs = get(remote);
      if (
        canonical(ours) !== canonical(original) &&
        canonical(theirs) !== canonical(original) &&
        canonical(ours) !== canonical(theirs)
      )
        return yield* Effect.fail(failure(true));
      const value = canonical(ours) === canonical(original) ? theirs : ours;
      if (value !== undefined) settings[key] = value;
    }
    const union = <
      T extends { readonly id?: string; readonly eventId?: string; readonly cardId?: string },
    >(
      ours: readonly T[],
      theirs: readonly T[],
    ) =>
      Effect.gen(function* () {
        const entries = new Map<string, T>();
        for (const item of [...theirs, ...ours]) {
          const key = item.id ?? item.eventId ?? item.cardId ?? "";
          const existing = entries.get(key);
          if (existing && canonical(existing) !== canonical(item))
            return yield* Effect.fail(failure(true));
          entries.set(key, item);
        }
        return [...entries.values()].sort((a, b) =>
          (a.id ?? a.eventId ?? a.cardId ?? "").localeCompare(b.id ?? b.eventId ?? b.cardId ?? ""),
        );
      });
    const result = yield* Schema.decodeUnknown(StudySyncDocumentSchema)({
      settings,
      importedSchedules: yield* union(
        local.importedSchedules ?? [],
        remote.importedSchedules ?? [],
      ),
      adjustments: yield* union(local.adjustments, remote.adjustments),
      corrections: yield* union(local.corrections, remote.corrections),
      undoStates: yield* union(local.undoStates, remote.undoStates),
    }).pipe(Effect.mapError(() => failure()));
    yield* validateStudySettings(result.settings).pipe(Effect.mapError(() => failure(true)));
    return result;
  });
}
export function applyStudyDocument(workspace: Workspace, document: StudySyncDocument): Workspace {
  return {
    ...workspace,
    schedulerSettings: document.settings,
    importedScheduleBaselines: document.importedSchedules ?? [],
    scheduleAdjustments: document.adjustments,
    reviewCorrections: document.corrections,
    reviewUndoStates: document.undoStates,
  };
}
export const StudySyncReplySchema = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  document: StudySyncDocumentSchema,
});
export function syncStudyDocument(
  workspace: Workspace,
  request: (
    input: import("./workspace-sync").WorkspaceSyncRequest,
  ) => Effect.Effect<import("./workspace-sync").WorkspaceSyncResponse, WorkspaceSyncFailure>,
) {
  return Effect.gen(function* () {
    const remote = yield* readStudyPages(request);
    const local = workspaceStudyDocument(workspace);
    const merged = yield* Effect.either(
      mergeStudyDocuments(
        workspace.syncStudyBaseline ?? emptyStudyDocument(),
        local,
        remote.document,
      ),
    );
    const conflict =
      merged._tag === "Left"
        ? { local: local.settings, remote: remote.document.settings }
        : undefined;
    const document =
      merged._tag === "Right"
        ? merged.right
        : yield* mergeStudyDocuments(
            { ...emptyStudyDocument(), settings: remote.document.settings },
            { ...local, settings: remote.document.settings },
            remote.document,
          );
    if (canonical(document) === canonical(remote.document))
      return { document, ...(conflict ? { conflict } : {}) };
    yield* writeStudyBatches(request, remote.revision, document, remote.document);
    return { document, ...(conflict ? { conflict } : {}) };
  });
}
