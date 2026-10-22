import type { SchedulerSettings } from "@recall/domain";
import { Effect } from "effect";
import { validateSchedulerWeights, validateSchedulingTimeZone } from "@recall/scheduler";
import { searchStudyCards } from "../search/card-search";

export function validateStudySettings(
  settings: SchedulerSettings,
): Effect.Effect<void, { readonly message: string }> {
  return Effect.gen(function* () {
    for (const override of settings.dailyLimitOverrides ?? []) {
      if (
        override.endsAt <= override.startsAt ||
        override.endsAt - override.startsAt > 172800000 ||
        !Number.isSafeInteger(override.startsAt) ||
        !Number.isSafeInteger(override.endsAt) ||
        (override.dailyNewLimit === undefined && override.dailyReviewLimit === undefined)
      )
        return yield* Effect.fail({
          message: "Today-only limits need valid calendar-day boundaries and at least one limit.",
        });
    }
    const presets = settings.presets ?? [];
    const searches = settings.savedSearches ?? [];
    const decks = settings.filteredDecks ?? [];
    if (
      new Set(decks.map((deck) => deck.id)).size !== decks.length ||
      decks.some((deck) => !deck.name.trim())
    )
      return yield* Effect.fail({
        message: "Use unique study collection identifiers and nonblank names.",
      });
    if (new Set(searches.map((search) => search.id)).size !== searches.length)
      return yield* Effect.fail({ message: "Use unique saved-search identifiers." });
    for (const query of [
      ...searches.map((search) => search.query),
      ...decks.map((deck) => deck.query),
      ...(settings.activeStudyQuery ? [settings.activeStudyQuery] : []),
    ])
      yield* searchStudyCards({ schemaVersion: 1, reviews: 0, areas: [] }, query, 0).pipe(
        Effect.mapError((error) => ({ message: error.message })),
      );
    const ids = new Set(presets.map((preset) => preset.id));
    if (
      ids.size !== presets.length ||
      new Set(presets.map((preset) => preset.name.trim().toLowerCase())).size !== presets.length ||
      presets.some((preset) => !preset.name.trim())
    )
      return yield* Effect.fail({ message: "Use distinct preset names and identifiers." });
    if (Object.values(settings.areaPresets ?? {}).some((id) => !ids.has(id)))
      return yield* Effect.fail({
        message: "A subject references a missing preset. Reassign it before deleting the preset.",
      });
    for (const area of Object.keys(settings.areaParents ?? {})) {
      const seen = new Set<string>();
      let current: string | undefined = area;
      while (current) {
        if (seen.has(current))
          return yield* Effect.fail({ message: "Subject groups cannot contain cycles." });
        seen.add(current);
        current = settings.areaParents?.[current];
      }
    }
    for (const policy of [settings, ...presets.map((preset) => preset.settings)]) {
      if (policy.weights)
        yield* validateSchedulerWeights(policy.weights).pipe(
          Effect.mapError(() => ({ message: "These fitted parameters are invalid." })),
        );
      if (policy.timeZone)
        yield* validateSchedulingTimeZone(policy.timeZone).pipe(
          Effect.mapError(() => ({
            message: "Choose a valid IANA time zone, such as Australia/Sydney.",
          })),
        );
      for (const steps of [policy.learningSteps, policy.relearningSteps])
        if (steps?.some((step, index) => index > 0 && step <= (steps[index - 1] ?? 0)))
          return yield* Effect.fail({
            message: "Learning steps must increase from shortest to longest.",
          });
    }
  });
}
