import { reviewPlacement, effectiveReviewEvents } from "@recall/domain";
import type { Workspace } from "@recall/domain";
import { recallProbability } from "@recall/scheduler";
import { resolveStudySettings, studyScope } from "../presets/resolve-settings";

export type CalendarBucket = {
  readonly label: string;
  readonly startsAt: number;
  readonly endsAt: number;
};
/** Calendar construction belongs at the platform boundary; explicit buckets keep aggregation pure. */
export function studyCalendar(
  now: number,
  pastDays = 30,
  futureDays = 30,
): { readonly past: readonly CalendarBucket[]; readonly future: readonly CalendarBucket[] } {
  const date = new Date(now);
  const bucket = (offset: number): CalendarBucket => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset + 1);
    const label = `${String(start.getFullYear())}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    return { label, startsAt: start.getTime(), endsAt: end.getTime() };
  };
  return {
    past: Array.from({ length: pastDays }, (_, index) => bucket(index - pastDays + 1)),
    future: Array.from({ length: futureDays }, (_, index) => bucket(index)),
  };
}
function distribution(values: readonly number[], thresholds: readonly number[]) {
  return thresholds.map((maximum, index) => ({
    label:
      index === thresholds.length - 1
        ? `${String(thresholds[index - 1] ?? 0)}+`
        : `${String(index === 0 ? 0 : thresholds[index - 1])}–${String(maximum)}`,
    count: values.filter((value) => value >= (thresholds[index - 1] ?? 0) && value < maximum)
      .length,
  }));
}
export function studyStatistics(
  workspace: Workspace,
  now: number,
  calendar: ReturnType<typeof studyCalendar>,
  areaId?: string,
) {
  const placement = reviewPlacement(workspace);
  const scope = areaId === undefined ? undefined : new Set(studyScope(workspace, areaId));
  const areas = workspace.areas.filter((area) => scope === undefined || scope.has(area.id));
  const cards = areas.flatMap((area) => area.cards.map((card) => ({ area, card })));
  const events = [
    ...new Map(
      effectiveReviewEvents(workspace)
        .filter((event) => scope === undefined || scope.has(placement.areaId(event)))
        .map((event) => [event.id, event]),
    ).values(),
  ].filter((event) => Date.parse(event.effectiveReviewedAt ?? event.ratedAt) <= now);
  const active = cards.filter(
    ({ card }) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id),
  );
  const probabilities = active
    .filter(({ card }) => card.schedule.state !== 0)
    .flatMap(({ area, card }) => {
      const probability = recallProbability(
        card.schedule,
        new Date(now),
        resolveStudySettings(workspace, area.id),
      );
      return probability === null ? [] : [probability];
    });
  const calendarRows = calendar.past.map((day) => {
    const reviews = events.filter((event) => {
      const at = Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
      return at >= day.startsAt && at < day.endsAt;
    });
    const firstByCard = new Map<string, (typeof events)[number]>();
    for (const event of [...reviews].sort(
      (left, right) =>
        Date.parse(left.effectiveReviewedAt ?? left.ratedAt) -
          Date.parse(right.effectiveReviewedAt ?? right.ratedAt) || left.id.localeCompare(right.id),
    )) {
      const key = placement.key(event);
      if (!firstByCard.has(key)) firstByCard.set(key, event);
    }
    const firsts = [...firstByCard.values()];
    return {
      ...day,
      reviews: reviews.length,
      elapsedMs: reviews.reduce((total, event) => total + (event.elapsedMs ?? 0), 0),
      timedReviews: reviews.filter((event) => event.elapsedMs != null).length,
      retentionAttempts: firsts.length,
      retentionPasses: firsts.filter((event) => event.rating !== "again").length,
    };
  });
  const attempts = calendarRows.reduce((sum, day) => sum + day.retentionAttempts, 0);
  const passes = calendarRows.reduce((sum, day) => sum + day.retentionPasses, 0);
  const forecast = calendar.future.map((day) => ({
    ...day,
    count: active.filter(
      ({ card }) =>
        card.schedule.state !== 0 &&
        Date.parse(card.schedule.due) >= day.startsAt &&
        Date.parse(card.schedule.due) < day.endsAt,
    ).length,
  }));
  const learned = active.filter(({ card }) => card.schedule.state !== 0);
  const elapsedMs = calendarRows.reduce((sum, day) => sum + day.elapsedMs, 0);
  return {
    totalCards: cards.length,
    newCards: active.filter(({ card }) => card.schedule.state === 0).length,
    suspendedCards: cards.length - active.length,
    learningCards: active.filter(
      ({ card }) => card.schedule.state === 1 || card.schedule.state === 3,
    ).length,
    reviewCards: active.filter(({ card }) => card.schedule.state === 2).length,
    overdue: active.filter(
      ({ card }) =>
        card.schedule.state !== 0 &&
        Date.parse(card.schedule.due) < (calendar.future[0]?.startsAt ?? now),
    ).length,
    calendar: calendarRows,
    forecast,
    elapsedMs,
    timedReviews: calendarRows.reduce((sum, day) => sum + day.timedReviews, 0),
    trueRetention: attempts ? passes / attempts : null,
    retentionAttempts: attempts,
    estimatedRemembered: probabilities.reduce((sum, probability) => sum + probability, 0),
    averageRecall: probabilities.length
      ? probabilities.reduce((sum, probability) => sum + probability, 0) / probabilities.length
      : null,
    dailyLoad: learned.reduce(
      (sum, { card }) => sum + 1 / Math.max(1, card.schedule.scheduled_days),
      0,
    ),
    intervals: distribution(
      learned.map(({ card }) => card.schedule.scheduled_days),
      [1, 7, 21, 90, 365, Infinity],
    ),
    stability: distribution(
      learned.map(({ card }) => card.schedule.stability),
      [1, 7, 21, 90, 365, Infinity],
    ),
    difficulty: distribution(
      learned.map(({ card }) => card.schedule.difficulty),
      [2, 4, 6, 8, Infinity],
    ),
    retrievability: distribution(
      probabilities.map((value) => value * 100),
      [50, 70, 80, 90, Infinity],
    ),
  } as const;
}
export type StudyStatistics = ReturnType<typeof studyStatistics>;
