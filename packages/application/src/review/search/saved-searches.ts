import { Effect } from "effect";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { validateStudyQuery } from "./card-search";
import { unusedStudyId } from "../presets/edit-presets";
export function saveStudySearch(settings: SchedulerSettings, name: string, query: string) {
  const saved = settings.savedSearches ?? [];
  if (
    !name.trim() ||
    name.trim().length > 80 ||
    !query.trim() ||
    saved.length >= 100 ||
    saved.some((search) => search.query === query.trim())
  )
    return Effect.fail({ message: "Use a name, a unique search, and at most 100 saved searches." });
  return validateStudyQuery(query).pipe(
    Effect.as({
      ...settings,
      savedSearches: [
        ...saved,
        { id: unusedStudyId("search", saved), name: name.trim(), query: query.trim() },
      ],
    }),
  );
}
export function removeStudySearch(settings: SchedulerSettings, query: string): SchedulerSettings {
  return {
    ...settings,
    savedSearches: settings.savedSearches?.filter((search) => search.query !== query),
  };
}
export function scheduledStudyFilter(
  settings: SchedulerSettings,
  query: string,
): SchedulerSettings {
  return { ...settings, activeStudyQuery: query.trim() };
}
export function suspensionSettings(
  workspace: Workspace,
  cardId: Workspace["areas"][number]["cards"][number]["id"],
): SchedulerSettings {
  const settings = workspace.schedulerSettings ?? { requestRetention: 0.9 };
  const ids = settings.suspendedCardIds ?? [];
  return {
    ...settings,
    suspendedCardIds: ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId],
  };
}
