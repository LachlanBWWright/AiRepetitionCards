import { MAX_COLLECTION_CARDS } from "@recall/domain";
import { Effect } from "effect";
import { createAssessmentId, type Assessment, type Workspace } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { captureCardVersion } from "../card-history";
import { deleteStudyCard, type CardManagementFailure } from "./card-management";
import { occlusionQuestions } from "./image-occlusion";

/** Rebuild sibling questions atomically, retaining identities and schedules for unchanged groups. */
export function reconcileOcclusionCards(
  workspace: Workspace,
  areaId: string,
  cardId: string,
  now: Date,
  previousWorkspace?: Workspace,
): Effect.Effect<Workspace, CardManagementFailure> {
  return Effect.gen(function* () {
    const area = workspace.areas.find((item) => item.id === areaId);
    const card = area?.cards.find((item) => item.id === cardId);
    if (!area || !card) return workspace;
    const previousArea = previousWorkspace?.areas.find((item) => item.id === areaId);
    const previousCard = previousArea?.cards.find((item) => item.id === cardId);
    if (!card.imageOcclusion) {
      if (!previousCard?.imageOcclusion) return workspace;
      const sourceId = previousCard.imageOcclusion.sourceId ?? previousCard.id;
      let converted = workspace;
      for (const sibling of area.cards.filter(
        (item) => item.id !== card.id && item.imageOcclusion?.sourceId === sourceId,
      ))
        converted = yield* deleteStudyCard(
          converted,
          { areaId, cardId: sibling.id },
          now,
          "replace",
        );
      const updatedAreas = converted.areas.map((item) => {
        if (item.id !== areaId) return item;
        return {
          ...item,
          cards: item.cards.map((entry) =>
            entry.id === card.id ? { ...entry, siblingId: undefined } : entry,
          ),
        };
      });
      return { ...converted, areas: updatedAreas };
    }
    const image = card.imageOcclusion;
    const sourceId = previousWorkspace
      ? (previousCard?.imageOcclusion?.sourceId ?? previousCard?.id ?? card.id)
      : (image.sourceId ?? card.id);
    const previousSiblings = (previousArea ?? area).cards.filter(
      (item) => item.id === card.id || item.imageOcclusion?.sourceId === sourceId,
    );
    const siblings = previousSiblings.some((item) => item.id === card.id)
      ? previousSiblings
      : [...previousSiblings, card];
    const key = (ids: readonly string[]) => [...ids].sort().join("\u001f");
    const questions = occlusionQuestions(image);
    if (area.cards.length - siblings.length + questions.length > MAX_COLLECTION_CARDS)
      return yield* Effect.fail({
        _tag: "CardManagementFailure",
        reason: "invalid-input",
        message: "The image would exceed this deck's 500-card limit.",
      } as const);
    const used = new Set<string>();
    const cards: Assessment[] = [];
    let result = workspace;
    for (const targetMaskIds of questions) {
      const previous = siblings.find(
        (item) =>
          item.imageOcclusion && key(item.imageOcclusion.targetMaskIds) === key(targetMaskIds),
      );
      const first =
        cards.length === 0 && (previousWorkspace ? !previousCard?.imageOcclusion : !image.sourceId);
      const identity =
        previous?.id ??
        (first
          ? card.id
          : createAssessmentId(`${sourceId}:occlusion:${encodeURIComponent(key(targetMaskIds))}`));
      const siblingIds = new Set(siblings.map((item) => item.id));
      const collision =
        workspace.areas.some((item) =>
          item.cards.some((entry) => entry.id === identity && !siblingIds.has(entry.id)),
        ) ||
        workspace.retainedReviewAreas?.some((item) =>
          item.cards.some((entry) => entry.id === identity),
        );
      if (collision)
        return yield* Effect.fail({
          _tag: "CardManagementFailure",
          reason: "invalid-input",
          message:
            "An image question identity conflicts with another card. Add a new mask instead.",
        } as const);
      const historical =
        workspace.reviewEvents?.some((event) => event.cardId === identity) ||
        workspace.deletedCards?.some((entry) => entry.cardId === identity);
      if (!previous && !first && historical)
        return yield* Effect.fail({
          _tag: "CardManagementFailure",
          reason: "invalid-input",
          message: "A deleted mask identity cannot be reused. Add a new mask instead.",
        } as const);
      used.add(identity);
      const next: Assessment = {
        ...card,
        id: identity,
        siblingId: `occlusion:${sourceId}`,
        schedule: previous?.schedule ?? (first ? card.schedule : newSchedule(now)),
        imageOcclusion: { ...image, sourceId, targetMaskIds },
      };
      if (
        previous &&
        JSON.stringify(previous.imageOcclusion) !== JSON.stringify(next.imageOcclusion)
      )
        result = captureCardVersion(result, area, previous, "edit", now);
      cards.push(next);
    }
    for (const sibling of siblings.filter((item) => !used.has(item.id)))
      result = yield* deleteStudyCard(result, { areaId, cardId: sibling.id }, now, "replace");
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));
    const areas = result.areas.map((item) =>
      item.id === areaId
        ? { ...item, cards: [...item.cards.filter((entry) => !siblingIds.has(entry.id)), ...cards] }
        : item,
    );
    return { ...result, areas };
  });
}
