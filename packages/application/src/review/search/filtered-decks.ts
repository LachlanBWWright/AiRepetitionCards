import { Effect, Schema } from "effect";
import {
  FilteredDeckSchema,
  type LearningArea,
  type SchedulerSettings,
  type Workspace,
} from "@recall/domain";
import { searchStudyCards } from "./card-search";
import { recallProbability } from "@recall/scheduler";
import { resolveStudySettings } from "../presets/resolve-settings";
/** Rebuild membership from live cards; original subjects and schedules remain intact. */
export function rebuildFilteredDeck(
  workspace: Workspace,
  input: unknown,
  now: number,
  fallback: LearningArea,
) {
  return Effect.gen(function* () {
    const deck = yield* Schema.decodeUnknown(FilteredDeckSchema)(input).pipe(
      Effect.mapError(() => ({
        message: "Choose a name, valid query, and a limit from 1 to 500.",
      })),
    );
    const entries = yield* searchStudyCards(workspace, deck.query, now, deck.areaId);
    const active = entries.filter(
      ({ card }) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id),
    );
    const score = (entry: (typeof active)[number]) =>
      deck.order === "weakest"
        ? (recallProbability(
            entry.card.schedule,
            new Date(now),
            resolveStudySettings(workspace, entry.area.id),
          ) ?? 1)
        : deck.order === "shortest" || deck.order === "longest"
          ? entry.card.schedule.scheduled_days * (deck.order === "longest" ? -1 : 1)
          : Date.parse(entry.card.schedule.due);
    const ranked = active
      .map((entry) => ({ entry, score: score(entry) }))
      .sort((a, b) => a.score - b.score || a.entry.card.id.localeCompare(b.entry.card.id));
    return {
      ...fallback,
      title: deck.name,
      cards: ranked.slice(0, deck.limit).map(({ entry }) => entry.card),
    };
  });
}
export function saveFilteredDeck(settings: SchedulerSettings, input: unknown) {
  return Schema.decodeUnknown(FilteredDeckSchema)(input).pipe(
    Effect.mapError(() => ({ message: "Enter a collection name and valid study options." })),
    Effect.flatMap((deck) => {
      const existing = settings.filteredDecks ?? [];
      if (existing.length >= 100 && !existing.some((item) => item.id === deck.id))
        return Effect.fail({ message: "Keep at most 100 study collections." });
      return Effect.succeed({
        ...settings,
        filteredDecks: [...existing.filter((item) => item.id !== deck.id), deck],
      });
    }),
  );
}
