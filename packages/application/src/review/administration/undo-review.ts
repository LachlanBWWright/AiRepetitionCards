import { Effect, Schema } from "effect";
import {
  ReviewEventIdSchema,
  WorkspaceSchema,
  effectiveReviewEvents,
  type Workspace,
} from "@recall/domain";
import { orderReviewEvents } from "@recall/sync-core";
import { rebuildWorkspaceSchedules } from "../schedule-replay";
export const UndoReviewCommandSchema = Schema.Struct({
  kind: Schema.Literal("undo-review"),
  eventId: ReviewEventIdSchema,
  operationId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
});
export function undoableReview(workspace: Workspace) {
  const last = orderReviewEvents(effectiveReviewEvents(workspace)).events.at(-1);
  return last &&
    !workspace.scheduleAdjustments?.some(
      (item) => item.cardId === last.cardId && item.afterReviewEventId === last.id,
    ) &&
    workspace.reviewUndoStates?.some((state) => state.eventId === last.id) &&
    workspace.areas.some((area) => area.cards.some((card) => card.id === last.cardId))
    ? last
    : undefined;
}
export function undoReview(
  workspaceInput: unknown,
  commandInput: unknown,
  now: Date,
): Effect.Effect<Workspace, { readonly message: string }> {
  return Effect.gen(function* () {
    const invalid = {
      message: "Only the latest available review can be undone. Refresh and try again.",
    };
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => invalid),
    );
    const command = yield* Schema.decodeUnknown(UndoReviewCommandSchema)(commandInput).pipe(
      Effect.mapError(() => invalid),
    );
    const existing = workspace.reviewCorrections?.find((item) => item.id === command.operationId);
    if (existing)
      return existing.eventId === command.eventId ? workspace : yield* Effect.fail(invalid);
    if (!Number.isFinite(now.getTime()) || undoableReview(workspace)?.id !== command.eventId)
      return yield* Effect.fail(invalid);
    return yield* rebuildWorkspaceSchedules({
      ...workspace,
      reviewCorrections: [
        ...(workspace.reviewCorrections ?? []),
        { id: command.operationId, eventId: command.eventId, recordedAt: now.toISOString() },
      ],
    }).pipe(
      Effect.mapError(() => ({
        message: "The review could not be restored. Your history is unchanged.",
      })),
    );
  });
}
