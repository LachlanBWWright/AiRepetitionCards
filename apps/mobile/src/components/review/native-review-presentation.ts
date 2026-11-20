import { designTokens } from "@recall/design-tokens";
import { Effect, Either } from "effect";
import { previewReviewSchedules } from "@recall/scheduler";
import { formatReviewDelay, reviewParameters } from "@recall/application";
import type { Assessment, Workspace } from "@recall/domain";
export function nativeReviewDelays(
  workspace: Workspace,
  areaId: string,
  card: Assessment | undefined,
  now: number,
) {
  if (!card) return {};
  const preview = Effect.runSync(
    Effect.either(
      previewReviewSchedules(
        card.schedule,
        new Date(now),
        reviewParameters(workspace, areaId, card.id),
      ),
    ),
  );
  return Either.isRight(preview)
    ? {
        again: formatReviewDelay(preview.right.again.due, now),
        hard: formatReviewDelay(preview.right.hard.due, now),
        good: formatReviewDelay(preview.right.good.due, now),
        easy: formatReviewDelay(preview.right.easy.due, now),
      }
    : {};
}

export const nativeReviewRatingColors = {
  again: designTokens.color.coral,
  hard: designTokens.color.amber,
  good: designTokens.color.green,
  easy: designTokens.color.violet,
};
