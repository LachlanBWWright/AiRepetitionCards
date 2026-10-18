import { recommendLearningActivities } from "@recall/application";
import type { ActivityLibrary } from "@recall/domain";

export function getLearningActivityRecommendations(
  library: ActivityLibrary,
  areaId: string,
  now: () => number,
) {
  return recommendLearningActivities(library, areaId, now());
}
