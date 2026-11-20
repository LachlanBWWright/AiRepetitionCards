import { Effect } from "effect";
import type { AssessmentId, SchedulerSettings, Workspace } from "@recall/domain";
import { localStudyDay } from "../study-day";
import { siblingKey, siblingNoteKeys } from "../sibling-identity";

export function isManuallyBuried(workspace: Workspace, cardId: string, now: number): boolean {
  return (workspace.schedulerSettings?.manualBurials?.[cardId] ?? 0) > now;
}

/** Deferral changes only private queue preferences, never schedules or answer evidence. */
export function buryStudyCard(
  workspace: Workspace,
  cardId: AssessmentId,
  scope: "card" | "note",
  now: number,
): Effect.Effect<SchedulerSettings, { readonly message: string }> {
  const area = workspace.areas.find((item) => item.cards.some((card) => card.id === cardId));
  const card = area?.cards.find((item) => item.id === cardId);
  if (!area || !card || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()))
    return Effect.fail({ message: "This card is unavailable. Refresh before burying it." });
  const settings = workspace.schedulerSettings ?? { requestRetention: 0.9 };
  const until = localStudyDay(now, settings.studyDayStartHour).endsAt;
  if (!Number.isFinite(until)) return Effect.fail({ message: "Choose a valid study date." });
  const keys = siblingNoteKeys(workspace);
  const source = siblingKey(card, area.id, keys);
  const ids = workspace.areas.flatMap((deck) =>
    deck.cards
      .filter(
        (item) =>
          item.id === cardId ||
          (scope === "note" && source !== undefined && siblingKey(item, deck.id, keys) === source),
      )
      .map((item) => item.id),
  );
  const active = Object.fromEntries(
    Object.entries(settings.manualBurials ?? {}).filter(([, endsAt]) => endsAt > now),
  );
  if (new Set([...Object.keys(active), ...ids]).size > 50000)
    return Effect.fail({ message: "Unbury existing cards before burying more cards." });
  return Effect.succeed({
    ...settings,
    manualBurials: { ...active, ...Object.fromEntries(ids.map((id) => [id, until])) },
  });
}

export function unburyStudyCards(workspace: Workspace): SchedulerSettings {
  return { ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }), manualBurials: {} };
}
