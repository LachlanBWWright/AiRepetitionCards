import { WorkspaceSchema, type ReviewEvent, type Workspace } from "@recall/domain";
import {
  rebuildScheduleEffect,
  schedulerParametersFromId,
  type SchedulerReplayFailure,
} from "@recall/scheduler";
import { Effect, Either, Schema } from "effect";

export type WorkspaceScheduleReplayError =
  | { readonly _tag: "WorkspaceScheduleReplayInvalid" }
  | {
      readonly _tag: "WorkspaceScheduleReplayInvalidTimestamp";
      readonly eventId: ReviewEvent["id"];
    }
  | SchedulerReplayFailure;

/** Rebuild derived schedules using each review's historical scheduler parameters. */
export function rebuildWorkspaceSchedules(
  input: unknown,
): Effect.Effect<Workspace, WorkspaceScheduleReplayError> {
  return Effect.gen(function* () {
    const decoded = Schema.decodeUnknownEither(WorkspaceSchema)(input);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail({ _tag: "WorkspaceScheduleReplayInvalid" } as const);
    }
    const workspace = decoded.right;
    const reviewsByArea = new Map<string, Map<string, ReviewEvent[]>>();
    for (const event of workspace.reviewEvents ?? []) {
      yield* schedulerParametersFromId(event.schedulerParameterSetId);
      if (!Number.isFinite(Date.parse(event.effectiveReviewedAt ?? event.ratedAt))) {
        return yield* Effect.fail({
          _tag: "WorkspaceScheduleReplayInvalidTimestamp",
          eventId: event.id,
        } as const);
      }
      const areaReviews = reviewsByArea.get(event.areaId) ?? new Map<string, ReviewEvent[]>();
      const cardReviews = areaReviews.get(event.cardId) ?? [];
      cardReviews.push(event);
      areaReviews.set(event.cardId, cardReviews);
      reviewsByArea.set(event.areaId, areaReviews);
    }
    const areas = yield* Effect.forEach(workspace.areas, (area) =>
      Effect.forEach(area.cards, (card) => {
        const events = reviewsByArea.get(area.id)?.get(card.id);
        return events
          ? rebuildScheduleEffect(events).pipe(Effect.map((schedule) => ({ ...card, schedule })))
          : Effect.succeed(card);
      }).pipe(Effect.map((cards) => ({ ...area, cards }))),
    );
    return { ...workspace, areas };
  });
}
