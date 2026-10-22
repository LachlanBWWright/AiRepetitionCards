import { reviewBudget } from "./study-limits";
import { reviewPlacement, effectiveReviewEvents } from "@recall/domain";
import type { Assessment, LearningArea, ReviewEvent, Workspace } from "@recall/domain";
import { recallProbability } from "@recall/scheduler";
import { resolveStudySettings, studyAncestors, studyScope } from "./presets/resolve-settings";
import { searchStudyCards } from "./search/card-search";
import { Effect, Either } from "effect";

export type StudyDay = { readonly startsAt: number; readonly endsAt: number };

/** Platform boundary supplies the local calendar day, including DST transitions. */
export function localStudyDay(now: number): StudyDay {
  const date = new Date(now);
  return {
    startsAt: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    endsAt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
  };
}

function siblingKey(
  card: Assessment,
  areaId: string,
  noteKeys: ReadonlyMap<string, string>,
): string | undefined {
  if (card.noteId) {
    const key = noteKeys.get(JSON.stringify([areaId, card.noteId]));
    if (key) return key;
  }
  const legacy =
    card.siblingId ??
    (card.cloze ? `cloze:${card.cloze.text}` : undefined) ??
    /^anki:(.+):\d+$/.exec(card.sourceId ?? "")?.[1];
  return legacy === undefined ? undefined : JSON.stringify(["legacy", areaId, legacy]);
}

function todayEvents(events: readonly ReviewEvent[], day: StudyDay): readonly ReviewEvent[] {
  return events.filter((event) => {
    const at = Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
    return at >= day.startsAt && at < day.endsAt;
  });
}

/** Counts actual failures; learning retries do not make a card a leech. */
export function studyCardStatus(workspace: Workspace, card: Assessment, areaId?: string) {
  const settings = areaId ? resolveStudySettings(workspace, areaId) : workspace.schedulerSettings;
  return {
    suspended: workspace.schedulerSettings?.suspendedCardIds?.includes(card.id) ?? false,
    leech: card.schedule.lapses >= (settings?.leechThreshold ?? 8),
    lapses: card.schedule.lapses,
  } as const;
}

export function studyQueue(workspace: Workspace, area: LearningArea, now: number, day: StudyDay) {
  const placement = reviewPlacement(workspace);
  const settings = resolveStudySettings(workspace, area.id);
  const allEvents = [
    ...new Map(effectiveReviewEvents(workspace).map((event) => [event.id, event])).values(),
  ];
  const events = todayEvents(allEvents, day);
  const firstReviewByCard = new Map<string, number>();
  const firstReviewAreas = new Map<string, string>();
  const latestReset = new Map<string, number>();
  for (const adjustment of workspace.scheduleAdjustments ?? [])
    if (adjustment.kind === "reset") {
      const key = placement.key(adjustment);
      latestReset.set(
        key,
        Math.max(latestReset.get(key) ?? -Infinity, Date.parse(adjustment.recordedAt)),
      );
    }
  for (const event of allEvents) {
    const at = Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
    const key = placement.key(event);
    firstReviewAreas.set(key, placement.areaId(event));
    if (at < (latestReset.get(key) ?? -Infinity)) continue;
    firstReviewByCard.set(key, Math.min(firstReviewByCard.get(key) ?? Infinity, at));
  }
  const introducedToday = [...firstReviewByCard.values()].filter(
    (at) => at >= day.startsAt && at < day.endsAt,
  ).length;
  const budget = reviewBudget(workspace, area.id, day, allEvents, now);
  const globalAllowance = Math.max(0, budget.globalNewLimit - introducedToday);
  const scopeAllowances = studyAncestors(workspace, area.id)
    .filter(
      (id) =>
        workspace.schedulerSettings?.areaPresets?.[id] !== undefined ||
        workspace.schedulerSettings?.dailyLimitOverrides?.some(
          (item) => item.areaId === id && item.startsAt <= now && item.endsAt > now,
        ),
    )
    .map((id) => {
      const scope = new Set(studyScope(workspace, id));
      const used = [...firstReviewByCard].filter(
        ([key, at]) =>
          scope.has(firstReviewAreas.get(key) ?? "") && at >= day.startsAt && at < day.endsAt,
      ).length;
      return Math.max(0, budget.newLimitFor(id) - used);
    });
  const newAllowance = Math.min(globalAllowance, ...scopeAllowances);
  const reviewedCards = new Set(
    events.filter((event) => placement.areaId(event) === area.id).map((event) => event.cardId),
  );
  const reviewedIdentities = new Set(events.map((event) => placement.key(event)));
  const noteKeys = new Map(
    workspace.areas.flatMap((deck) =>
      (deck.noteLibrary?.notes ?? []).map(
        (note) =>
          [
            JSON.stringify([deck.id, note.id]),
            JSON.stringify([
              "note",
              note.source?.areaId ?? deck.id,
              note.source?.noteId ?? note.id,
            ]),
          ] as const,
      ),
    ),
  );
  const reviewedSiblings = new Set(
    workspace.areas.flatMap((deck) =>
      deck.cards
        .filter((card) => reviewedIdentities.has(JSON.stringify([deck.id, card.id])))
        .map((card) => siblingKey(card, deck.id, noteKeys))
        .filter((key) => key !== undefined),
    ),
  );
  const due = area.cards.filter(
    (card) => Date.parse(card.schedule.due) <= now && !studyCardStatus(workspace, card).suspended,
  );
  const buried = due.filter((card) => {
    const bury =
      card.schedule.state === 0
        ? settings.buryNewSiblings
        : card.schedule.state === 2
          ? settings.buryReviewSiblings
          : settings.buryLearningSiblings;
    return (
      (bury ?? settings.burySiblings ?? true) &&
      !reviewedCards.has(card.id) &&
      reviewedSiblings.has(siblingKey(card, area.id, noteKeys) ?? "")
    );
  });
  const buriedIds = new Set(buried.map((card) => card.id));
  const overdue = workspace.areas.some((deck) =>
    deck.cards.some(
      (card) =>
        card.schedule.state !== 0 &&
        Date.parse(card.schedule.due) < day.startsAt &&
        !studyCardStatus(workspace, card).suspended,
    ),
  );
  const pauseNew = (settings.pauseNewWhenOverdue ?? true) && overdue;
  const unfiltered = due.filter((card) => !buriedIds.has(card.id));
  const search = settings.activeStudyQuery
    ? Effect.runSync(
        Effect.either(searchStudyCards(workspace, settings.activeStudyQuery, now, area.id)),
      )
    : undefined;
  const filteredIds = search
    ? new Set(Either.isRight(search) ? search.right.map(({ card }) => card.id) : [])
    : undefined;
  const eligible = filteredIds ? unfiltered.filter((card) => filteredIds.has(card.id)) : unfiltered;
  const priority = (card: Assessment) =>
    card.schedule.state === 1 || card.schedule.state === 3
      ? 0
      : settings.newReviewOrder === "mix"
        ? 1
        : card.schedule.state === 0
          ? settings.newReviewOrder === "before"
            ? 1
            : 2
          : settings.newReviewOrder === "before"
            ? 2
            : 1;
  const scores = new Map(
    eligible
      .filter((card) => card.schedule.state === 2 && settings.reviewOrder === "retrievability")
      .map((card) => [card.id, recallProbability(card.schedule, new Date(now), settings)]),
  );
  const ordered = [...eligible].sort((left, right) => {
    const group = priority(left) - priority(right);
    if (group !== 0) return group;
    if (settings.newReviewOrder === "mix" && priority(left) !== 0)
      return (
        Date.parse(left.schedule.due) - Date.parse(right.schedule.due) ||
        left.id.localeCompare(right.id, "en")
      );
    if (left.schedule.state === 0 && right.schedule.state === 0) {
      const position =
        (workspace.schedulerSettings?.newCardPositions?.[left.id] ?? 500_000) -
        (workspace.schedulerSettings?.newCardPositions?.[right.id] ?? 500_000);
      if (position !== 0) return position;
    }
    if (
      left.schedule.state === 2 &&
      right.schedule.state === 2 &&
      (settings.reviewOrder === "interval-ascending" ||
        settings.reviewOrder === "interval-descending")
    ) {
      const interval = left.schedule.scheduled_days - right.schedule.scheduled_days;
      if (interval !== 0)
        return settings.reviewOrder === "interval-ascending" ? interval : -interval;
    }
    if (
      settings.reviewOrder === "retrievability" &&
      left.schedule.state === 2 &&
      right.schedule.state === 2
    ) {
      const leftScore = scores.get(left.id) ?? Infinity;
      const rightScore = scores.get(right.id) ?? Infinity;
      if (leftScore !== rightScore) return leftScore - rightScore;
    }
    return (
      Date.parse(left.schedule.due) - Date.parse(right.schedule.due) ||
      left.id.localeCompare(right.id, "en")
    );
  });
  let remainingNew = pauseNew ? 0 : newAllowance;
  let remainingReview = budget.remaining;
  const cards = ordered.filter((card) => {
    if (card.schedule.state === 0) return remainingNew-- > 0;
    if (card.schedule.state !== 2 || budget.reviewedCardIds.has(card.id)) return true;
    return remainingReview-- > 0;
  });
  return {
    cards,
    dueCount: due.length,
    deferredReviewCount:
      ordered.filter((card) => card.schedule.state === 2).length -
      cards.filter((card) => card.schedule.state === 2).length,
    reviewAllowance: budget.remaining,
    reviewedToday: budget.reviewedToday,
    buriedCount: buried.length,
    filteredCount: unfiltered.length - eligible.length,
    deferredNewCount:
      ordered.filter((card) => card.schedule.state === 0).length -
      cards.filter((card) => card.schedule.state === 0).length,
    introducedToday,
    newAllowance,
    pauseNew,
    leeches: area.cards.filter((card) => studyCardStatus(workspace, card, area.id).leech),
  } as const;
}
