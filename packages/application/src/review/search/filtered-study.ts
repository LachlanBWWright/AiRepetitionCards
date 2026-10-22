import type { LearningArea, Workspace } from "@recall/domain";
import { Effect } from "effect";
import { searchStudyCards } from "./card-search";
import { recallProbability } from "@recall/scheduler";
import { resolveStudySettings } from "../presets/resolve-settings";
export type FilteredStudyOrder = "due" | "weakest" | "shortest" | "longest";
export function filteredStudyArea(
  workspace: Workspace,
  area: LearningArea,
  query: unknown,
  now: number,
  limit = 100,
  order: FilteredStudyOrder = "due",
) {
  return searchStudyCards(workspace, query, now, area.id).pipe(
    Effect.map((matches) => {
      const settings = resolveStudySettings(workspace, area.id);
      const cards = matches
        .map((entry) => entry.card)
        .filter((card) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id));
      const probabilities = new Map(
        cards.map((card) => [
          card.id,
          order === "weakest"
            ? (recallProbability(card.schedule, new Date(now), settings) ?? 1)
            : 1,
        ]),
      );
      const sorted = [...cards].sort((left, right) => {
        const difference =
          order === "weakest"
            ? (probabilities.get(left.id) ?? 1) - (probabilities.get(right.id) ?? 1)
            : order === "shortest" || order === "longest"
              ? (left.schedule.scheduled_days - right.schedule.scheduled_days) *
                (order === "longest" ? -1 : 1)
              : Date.parse(left.schedule.due) - Date.parse(right.schedule.due);
        return difference || left.id.localeCompare(right.id, "en");
      });
      return {
        ...area,
        cards: sorted.slice(0, Math.max(1, Math.min(500, Math.floor(limit) || 100))),
      };
    }),
  );
}
