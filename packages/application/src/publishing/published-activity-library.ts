import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema, WorkspaceSchema, type LearningActivity } from "@recall/domain";
import { decodeActivityLibrary, type ActivityFailure } from "../activities/learning-activities";

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
};

const collision = (id: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason: "conflict",
  message: `Activity “${id}” belongs to a different area.`,
});
const revisionConflict = (id: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason: "conflict",
  message: `Activity “${id}” has different content at the same revision.`,
});

/** Persist received definitions with the workspace before acknowledging a copy or selected update. */
export function retainPublishedActivityDefinitions(
  workspace: unknown,
  document: unknown,
  options: { readonly replaceArea?: boolean } = {},
) {
  return Effect.gen(function* () {
    const current = yield* Schema.decodeUnknown(WorkspaceSchema)(workspace);
    const area = yield* Schema.decodeUnknown(KnowledgeAreaSchema)(document);
    if (area.activities === undefined) return current;
    const library = yield* decodeActivityLibrary(
      current.activityLibrary ?? { version: 1, activities: [], attempts: [] },
    );
    const byId = new Map(library.activities.map((activity) => [activity.id, activity]));
    for (const activity of area.activities) {
      const existing = byId.get(activity.id);
      if (existing && existing.areaId !== area.id)
        return yield* Effect.fail(collision(activity.id));
      if (
        options.replaceArea !== true &&
        existing &&
        existing.revision === activity.revision &&
        stable(existing) !== stable(activity)
      )
        return yield* Effect.fail(revisionConflict(activity.id));
    }
    const incoming = area.activities.map((activity) => {
      const existing = byId.get(activity.id);
      if (options.replaceArea !== true && existing) {
        if (existing.revision > activity.revision) return existing;
        if (existing.revision === activity.revision) return existing;
      }
      return activity;
    });
    const incomingIds = new Set(incoming.map((activity) => activity.id));
    const retired =
      options.replaceArea === true
        ? library.activities.flatMap((activity) => {
            if (
              activity.areaId !== area.id ||
              incomingIds.has(activity.id) ||
              activity.archived === true
            )
              return [activity];
            return [{ ...activity, archived: true, revision: activity.revision + 1 }];
          })
        : library.activities;
    const mergedById = new Map<string, LearningActivity>(
      retired.map((activity) => [activity.id, activity]),
    );
    for (const activity of incoming) mergedById.set(activity.id, activity);
    const activityLibrary = yield* decodeActivityLibrary({
      ...library,
      activities: [...mergedById.values()],
    });
    return { ...current, activityLibrary };
  });
}
