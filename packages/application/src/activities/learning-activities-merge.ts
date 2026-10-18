import { Effect } from "effect";
import type { ActivityLibrary } from "@recall/domain";
import { failure, type ActivityFailure } from "./learning-activities-plugins";
import { stable } from "./learning-activities-stable";

export function mergeLibraries(
  localInput: unknown,
  remoteInput: unknown,
  decode: (input: unknown) => Effect.Effect<ActivityLibrary, ActivityFailure>,
): Effect.Effect<ActivityLibrary, ActivityFailure> {
  return Effect.gen(function* () {
    const local = yield* decode(localInput);
    const remote = yield* decode(remoteInput);
    const activities = new Map(remote.activities.map((activity) => [activity.id, activity]));
    for (const activity of local.activities) {
      const previous = activities.get(activity.id);
      if (
        previous &&
        previous.revision === activity.revision &&
        stable(previous) !== stable(activity)
      )
        return yield* Effect.fail(
          failure(
            "conflict",
            `Activity “${activity.title}” was edited differently on another device. Export your local activities before loading the remote version.`,
          ),
        );
      if (!previous || activity.revision > previous.revision) activities.set(activity.id, activity);
    }
    const attempts = new Map(remote.attempts.map((attempt) => [attempt.id, attempt]));
    for (const attempt of local.attempts) {
      const previous = attempts.get(attempt.id);
      if (previous && stable(previous) !== stable(attempt))
        return yield* Effect.fail(
          failure("conflict", "Accepted attempt identities cannot be overwritten."),
        );
      attempts.set(attempt.id, attempt);
    }
    const drafts = new Map((remote.drafts ?? []).map((draft) => [draft.id, draft]));
    for (const draft of local.drafts ?? []) {
      if (attempts.has(draft.id)) continue;
      const previous = drafts.get(draft.id);
      if (previous && previous.updatedAt === draft.updatedAt && stable(previous) !== stable(draft))
        return yield* Effect.fail(
          failure(
            "conflict",
            "Attempt progress was changed differently on another device. Keep your local work before resolving the conflict.",
          ),
        );
      if (!previous || draft.updatedAt > previous.updatedAt) drafts.set(draft.id, draft);
    }
    for (const id of attempts.keys()) drafts.delete(id);
    const editorIsSaved = (draft: NonNullable<ActivityLibrary["editorDrafts"]>[number]) => {
      const saved = activities.get(draft.editing?.id ?? draft.id);
      return saved !== undefined && (!draft.editing || saved.revision > draft.editing.revision);
    };
    const editorDrafts = new Map(
      (remote.editorDrafts ?? [])
        .filter((draft) => !editorIsSaved(draft))
        .map((draft) => [draft.id, draft]),
    );
    for (const draft of local.editorDrafts ?? []) {
      if (editorIsSaved(draft)) continue;
      const previous = editorDrafts.get(draft.id);
      if (previous && previous.updatedAt === draft.updatedAt && stable(previous) !== stable(draft))
        return yield* Effect.fail(
          failure(
            "conflict",
            "An activity draft was changed differently on another device. Keep your local work before resolving the conflict.",
          ),
        );
      if (!previous || draft.updatedAt > previous.updatedAt) editorDrafts.set(draft.id, draft);
    }

    return yield* decode({
      version: 1,
      activities: [...activities.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      attempts: [...attempts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      drafts: [...drafts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      editorDrafts: [...editorDrafts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
    });
  });
}
