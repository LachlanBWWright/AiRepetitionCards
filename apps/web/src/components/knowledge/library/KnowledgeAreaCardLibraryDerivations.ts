import { findDuplicateCardPairs, workspaceDuplicateCandidates } from "@recall/application";
import type { LearningArea, Workspace } from "@recall/domain";

export type KnowledgeAreaCardLibraryDuplicateScope = "area" | "workspace";

export function getKnowledgeAreaCardLibraryDuplicates(
  workspace: Workspace | undefined,
  area: LearningArea,
  scanDuplicates: boolean,
  duplicateScope: KnowledgeAreaCardLibraryDuplicateScope,
) {
  const candidates = workspace
    ? workspaceDuplicateCandidates(workspace)
    : area.cards.map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        ...(card.cloze ? { cloze: card.cloze } : {}),
        areaId: area.id,
        areaTitle: area.title,
      }));
  const scoped =
    duplicateScope === "area"
      ? candidates.filter((candidate) => candidate.areaId === area.id)
      : candidates;
  return scanDuplicates ? findDuplicateCardPairs(scoped) : [];
}

export function getKnowledgeAreaCardLibraryFilteredCards(
  area: LearningArea,
  search: string,
  objectiveFilter: string,
  flaggedOnly: boolean,
  flaggedCardIds: readonly string[],
) {
  const objectives = area.objectives ?? [];
  const query = search.trim().toLocaleLowerCase();
  return area.cards.filter((card) => {
    const matchesQuery = [card.front, card.back, ...(card.tags ?? [])].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
    const matchesObjective =
      !objectiveFilter ||
      objectives.some(
        (objective) =>
          `id:${objective.id}` === objectiveFilter &&
          ((card.objectiveIds ?? []).includes(objective.id) || card.objective === objective.title),
      ) ||
      `title:${card.objective}` === objectiveFilter;
    return matchesQuery && matchesObjective && (!flaggedOnly || flaggedCardIds.includes(card.id));
  });
}
