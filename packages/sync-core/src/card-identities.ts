import { createAreaId, createAssessmentId, reviewPlacement, type Workspace } from "@recall/domain";
import { stableSyncId } from "./ids";

/** Explicit move lineage preserves pre-sync seeds; unrelated legacy aliases stay area-scoped. */
export function cardIdentityNormalizer(workspace: Workspace, identityAreas: Workspace["areas"]) {
  const placement = reviewPlacement(workspace);
  const origins = new Map(identityAreas.map((area) => [area.id, area]));
  return (area: Workspace["areas"][number], card: Workspace["areas"][number]["cards"][number]) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(card.id))
      return card.id;
    const origin =
      origins.get(createAreaId(placement.identityAreaId({ areaId: area.id, cardId: card.id }))) ??
      area;
    return createAssessmentId(
      stableSyncId(`card:${origin.sourceId ?? origin.id}:${card.sourceId ?? card.id}`),
    );
  };
}
