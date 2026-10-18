import type { Workspace } from "@recall/domain";
import { recommendLearningActivities, type LibraryNotes } from "@recall/application";

export function getDeepPracticeRecommendations(
  workspace: Workspace | null,
  activityLibrary: Parameters<typeof recommendLearningActivities>[0],
  now: number,
) {
  return (workspace?.areas ?? [])
    .flatMap((area) => recommendLearningActivities(activityLibrary, area.id, now))
    .sort(
      (left, right) =>
        right.priority - left.priority || left.activity.id.localeCompare(right.activity.id, "en"),
    )
    .slice(0, 3);
}

export function getActivityDefinitionSnapshot(notes: LibraryNotes, areaId: string): string {
  return JSON.stringify(
    (notes.activityLibrary?.activities ?? [])
      .filter((activity) => activity.areaId === areaId && !activity.archived)
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
  );
}
