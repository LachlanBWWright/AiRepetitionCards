import {
  effectiveReviewEvents,
  reviewPlacement,
  WorkspaceSchema,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import {
  rebuildScheduleEffect,
  schedulerParametersFromId,
  type SchedulerReplayFailure,
} from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import { Effect, Either, Schema } from "effect";
import { applyPendingScheduleAdjustments } from "./administration/manual-scheduling";

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
    const original = decoded.right;
    const placement = reviewPlacement(original);
    const baselines = new Map(
      (original.importedScheduleBaselines ?? []).map((item) => [
        placement.key(item),
        item.baseline,
      ]),
    );
    const workspace: Workspace = {
      ...original,
      areas: original.areas.map((area) => ({
        ...area,
        cards: area.cards.map((card) => {
          const importedSchedule =
            baselines.get(placement.key({ areaId: area.id, cardId: card.id })) ??
            card.importedSchedule;
          return importedSchedule ? { ...card, importedSchedule } : card;
        }),
      })),
    };
    const reviewsByArea = new Map<string, Map<string, ReviewEvent[]>>();
    for (const event of effectiveReviewEvents(workspace)) {
      yield* schedulerParametersFromId(event.schedulerParameterSetId);
      if (!Number.isFinite(Date.parse(event.effectiveReviewedAt ?? event.ratedAt))) {
        return yield* Effect.fail({
          _tag: "WorkspaceScheduleReplayInvalidTimestamp",
          eventId: event.id,
        } as const);
      }
      const areaReviews =
        reviewsByArea.get(placement.areaId(event)) ?? new Map<string, ReviewEvent[]>();
      const cardReviews = areaReviews.get(event.cardId) ?? [];
      cardReviews.push(event);
      areaReviews.set(event.cardId, cardReviews);
      reviewsByArea.set(placement.areaId(event), areaReviews);
    }
    const areas = yield* Effect.forEach(workspace.areas, (area) =>
      Effect.forEach(area.cards, (card) => {
        const importedIds = new Set(card.importedSchedule?.reviewEventIds ?? []);
        const events = reviewsByArea
          .get(area.id)
          ?.get(card.id)
          ?.filter((event) => !importedIds.has(event.id));
        const history = (workspace.reviewEvents ?? []).filter(
          (event) =>
            placement.areaId(event) === area.id &&
            event.cardId === card.id &&
            !importedIds.has(event.id),
        );
        const first = orderReviewEvents(history).events[0];
        const snapshot = first
          ? workspace.reviewUndoStates?.find((state) => state.eventId === first.id)
          : undefined;
        if (!events?.length && snapshot)
          return Effect.succeed({ ...card, schedule: snapshot.schedule });
        if (!events?.length && card.importedSchedule)
          return Effect.succeed({ ...card, schedule: card.importedSchedule.schedule });
        return events?.length
          ? rebuildScheduleEffect(
              events,
              undefined,
              card.importedSchedule?.schedule ?? snapshot?.schedule,
            ).pipe(Effect.map((schedule) => ({ ...card, schedule })))
          : Effect.succeed(card);
      }).pipe(Effect.map((cards) => ({ ...area, cards }))),
    );
    return applyPendingScheduleAdjustments({ ...workspace, areas });
  });
}
