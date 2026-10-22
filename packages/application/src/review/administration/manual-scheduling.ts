import { reviewPlacement, effectiveReviewEvents } from "@recall/domain";
import { Effect, Schema } from "effect";
import { AreaIdSchema, AssessmentIdSchema, WorkspaceSchema, type Workspace } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import { normalizeManualDue } from "./manual-time";

export const ManualSchedulingCommandSchema = Schema.Struct({
  kind: Schema.Literal("administer-cards"),
  areaId: AreaIdSchema,
  cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
  operationId: Schema.String.pipe(Schema.minLength(1)),
  action: Schema.Literal("due", "reset", "reposition"),
  due: Schema.optional(Schema.String),
  position: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000_000))),
});
export type ManualSchedulingCommand = typeof ManualSchedulingCommandSchema.Type;
export function administerCards(
  workspaceInput: unknown,
  commandInput: unknown,
  now: Date,
): Effect.Effect<Workspace, { readonly message: string }> {
  return Effect.gen(function* () {
    const invalid = { message: "Choose existing cards and a valid scheduling action." };
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => invalid),
    );
    const placement = reviewPlacement(workspace);
    const command = yield* Schema.decodeUnknown(ManualSchedulingCommandSchema)(commandInput).pipe(
      Effect.mapError(() => invalid),
    );
    const area = workspace.areas.find((item) => item.id === command.areaId);
    const ids = [...new Set(command.cardIds)];
    if (
      !area ||
      !Number.isFinite(now.getTime()) ||
      ids.some((id) => !area.cards.some((card) => card.id === id))
    )
      return yield* Effect.fail(invalid);
    if (command.action === "reposition") {
      const position = command.position;
      if (
        position === undefined ||
        position + ids.length - 1 > 1_000_000 ||
        area.cards.some((card) => ids.includes(card.id) && card.schedule.state !== 0)
      )
        return yield* Effect.fail({
          message: "Only new cards can be repositioned. Use positions between 0 and 1,000,000.",
        });
      return {
        ...workspace,
        schedulerSettings: {
          ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }),
          newCardPositions: {
            ...workspace.schedulerSettings?.newCardPositions,
            ...Object.fromEntries(ids.map((id, index) => [id, position + index])),
          },
        },
      };
    }
    const due = command.action === "due" ? normalizeManualDue(command.due) : now.toISOString();
    if (!due)
      return yield* Effect.fail({ message: "Choose a valid due date with an explicit time zone." });
    if (
      (workspace.scheduleAdjustments ?? []).some(
        (item) =>
          ids.some((id) => item.id === `${command.operationId}:${id}`) &&
          (placement.areaId(item) !== area.id ||
            item.kind !== command.action ||
            (command.action === "due" && item.due !== due)),
      )
    )
      return yield* Effect.fail({
        message: "This scheduling operation identifier was already used for a different change.",
      });
    const adjustments = [...(workspace.scheduleAdjustments ?? [])];
    const updated = area.cards.map((card) => {
      if (!ids.includes(card.id)) return card;
      const id = `${command.operationId}:${card.id}`;
      if (adjustments.some((item) => item.id === id)) return card;
      const recordedAt = new Date(
        Math.max(
          now.getTime(),
          ...adjustments
            .filter((item) => placement.areaId(item) === area.id && item.cardId === card.id)
            .map((item) => Date.parse(item.recordedAt) + 1),
          typeof card.schedule.last_review === "string"
            ? Date.parse(card.schedule.last_review) + 1
            : now.getTime(),
        ),
      ).toISOString();
      const lastReview = orderReviewEvents(
        effectiveReviewEvents(workspace).filter(
          (event) => placement.areaId(event) === area.id && event.cardId === card.id,
        ),
      ).events.at(-1);
      const reset = command.action === "reset";
      adjustments.push({
        id,
        areaId: area.id,
        cardId: card.id,
        afterReviewEventId: lastReview?.id ?? null,
        recordedAt,
        kind: reset ? "reset" : "due",
        due: reset ? recordedAt : due,
      });
      return {
        ...card,
        schedule: reset ? newSchedule(new Date(recordedAt)) : { ...card.schedule, due },
      };
    });
    return {
      ...workspace,
      scheduleAdjustments: adjustments,
      areas: workspace.areas.map((item) =>
        item.id === area.id ? { ...item, cards: updated } : item,
      ),
    };
  });
}

/** Pending local adjustments overlay caches until a subsequent review consumes them. */
export function applyPendingScheduleAdjustments(workspace: Workspace): Workspace {
  const placement = reviewPlacement(workspace);
  return {
    ...workspace,
    areas: workspace.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => {
        const latestReview =
          orderReviewEvents(
            effectiveReviewEvents(workspace).filter(
              (event) => placement.areaId(event) === area.id && event.cardId === card.id,
            ),
          ).events.at(-1)?.id ?? null;
        const pending = (workspace.scheduleAdjustments ?? [])
          .filter(
            (item) =>
              placement.areaId(item) === area.id &&
              item.cardId === card.id &&
              item.afterReviewEventId === latestReview,
          )
          .sort(
            (left, right) =>
              Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
              left.id.localeCompare(right.id),
          );
        const schedule = pending.reduce(
          (current, adjustment) =>
            adjustment.kind === "reset"
              ? newSchedule(new Date(adjustment.recordedAt))
              : { ...current, due: adjustment.due },
          card.schedule,
        );
        return { ...card, schedule };
      }),
    })),
  };
}
