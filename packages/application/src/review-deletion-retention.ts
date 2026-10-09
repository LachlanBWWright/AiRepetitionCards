import {
  type AreaId,
  type AssessmentId,
  type LearningArea,
  type Workspace,
  WorkspaceSchema,
} from "@recall/domain";
import { Effect, Schema } from "effect";

export type ReviewDeletionRetentionFailure = { readonly _tag: "ReviewDeletionRetentionFailure" };

function pendingCards(workspace: Workspace, areaId: AreaId): ReadonlySet<AssessmentId> {
  const pending = new Set(
    workspace.pendingReviewEventIds ?? workspace.reviewEvents?.map((event) => event.id) ?? [],
  );
  return new Set(
    (workspace.reviewEvents ?? [])
      .filter((event) => event.areaId === areaId && pending.has(event.id))
      .map((event) => event.cardId),
  );
}

/** Retained content is private identity evidence, never an active study or publication area. */
export function retainedReviewContent(workspace: Workspace): readonly LearningArea[] {
  return workspace.retainedReviewAreas ?? [];
}

export function validateRetainedReviewContent(
  workspace: Workspace,
): Effect.Effect<Workspace, ReviewDeletionRetentionFailure> {
  return Schema.decodeUnknown(WorkspaceSchema)(workspace).pipe(
    Effect.mapError(() => ({ _tag: "ReviewDeletionRetentionFailure" }) as const),
    Effect.flatMap((decoded) => {
      const areas = retainedReviewContent(decoded);
      const cardIds = areas.flatMap((area) => area.cards.map((card) => card.id));
      const activeCards = new Set(
        decoded.areas.flatMap((area) => area.cards.map((card) => card.id)),
      );
      const valid =
        new Set(areas.map((area) => area.id)).size === areas.length &&
        new Set(cardIds).size === cardIds.length &&
        areas.every((area) => {
          const objectives = new Set(area.objectives?.map((objective) => objective.id) ?? []);
          return (
            (area.objectives ?? []).every((objective) =>
              objective.prerequisiteIds.every((id) => objectives.has(id)),
            ) &&
            area.cards.every(
              (card) =>
                !activeCards.has(card.id) &&
                (card.objectiveIds ?? []).every((id) => objectives.has(id)) &&
                decoded.reviewEvents?.some(
                  (event) => event.areaId === area.id && event.cardId === card.id,
                ) &&
                (decoded.deletedAreas?.some((item) => item.areaId === area.id) ||
                  decoded.deletedCards?.some(
                    (item) => item.areaId === area.id && item.cardId === card.id,
                  )),
            )
          );
        });
      return valid
        ? Effect.succeed(decoded)
        : Effect.fail({ _tag: "ReviewDeletionRetentionFailure" } as const);
    }),
  );
}

export function retainReviewDeletionContent(
  workspace: Workspace,
  source: LearningArea,
  removedCardIds: readonly AssessmentId[],
): Effect.Effect<Workspace, ReviewDeletionRetentionFailure> {
  const previous = retainedReviewContent(workspace).find((area) => area.id === source.id);
  const pending = pendingCards(workspace, source.id);
  const removed = new Set(removedCardIds);
  const cards = new Map((previous?.cards ?? []).map((card) => [card.id, card]));
  for (const card of source.cards)
    if (removed.has(card.id) && pending.has(card.id) && !cards.has(card.id))
      cards.set(card.id, card);
  if (cards.size === 0) return validateRetainedReviewContent(workspace);
  const objectives = new Map(
    [...(source.objectives ?? []), ...(previous?.objectives ?? [])].map((objective) => [
      objective.id,
      objective,
    ]),
  );
  const required = new Set([...cards.values()].flatMap((card) => card.objectiveIds ?? []));
  for (const objective of objectives.values())
    if (
      [...cards.values()].some((card) => !card.objectiveIds && card.objective === objective.title)
    )
      required.add(objective.id);
  const visit = [...required];
  for (const objectiveId of visit)
    for (const id of objectives.get(objectiveId)?.prerequisiteIds ?? [])
      if (!required.has(id)) {
        required.add(id);
        visit.push(id);
      }
  const snapshot: LearningArea = {
    ...source,
    ...previous,
    cards: [...cards.values()],
    ...(objectives.size > 0
      ? {
          objectives: [...objectives.values()].filter(
            (objective) =>
              required.has(objective.id) ||
              [...cards.values()].some(
                (card) => !card.objectiveIds && card.objective === objective.title,
              ),
          ),
        }
      : {}),
  };
  return validateRetainedReviewContent({
    ...workspace,
    retainedReviewAreas: [
      ...retainedReviewContent(workspace).filter((area) => area.id !== source.id),
      snapshot,
    ],
  });
}

/** Review ACKs alone cannot release the only content needed to finish a tombstone. */
export function releaseRetainedReviewContent(
  workspace: Workspace,
  receipts: {
    readonly deletedAreaIds: readonly AreaId[];
    readonly deletedCardIds: readonly AssessmentId[];
  },
): Workspace {
  const deletedAreas = new Set(receipts.deletedAreaIds);
  const deletedCards = new Set(receipts.deletedCardIds);
  const retainedReviewAreas = retainedReviewContent(workspace).flatMap((area) => {
    const pending = pendingCards(workspace, area.id);
    const wholeArea = workspace.deletedAreas?.some((item) => item.areaId === area.id);
    const cards = area.cards.filter(
      (card) =>
        pending.has(card.id) ||
        (wholeArea ? !deletedAreas.has(area.id) : !deletedCards.has(card.id)),
    );
    return cards.length > 0 ? [{ ...area, cards }] : [];
  });
  return { ...workspace, retainedReviewAreas };
}
