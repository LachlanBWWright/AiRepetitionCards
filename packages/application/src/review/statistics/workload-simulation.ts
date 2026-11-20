import { localStudyDay } from "../study-day";
import { siblingKey, siblingNoteKeys } from "../sibling-identity";
import { SimulationHeap } from "./simulation-heap";
import { Effect, Schema } from "effect";
import {
  reviewPlacement,
  effectiveReviewEvents,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import { newSchedule, recallProbability, scheduleReview } from "@recall/scheduler";
import { resolveStudySettings, studyScope } from "../presets/resolve-settings";
const OptionsSchema = Schema.Struct({
  days: Schema.Number.pipe(Schema.int(), Schema.between(1, 180)),
  retention: Schema.Number.pipe(Schema.between(0.7, 0.97)),
  newPerDay: Schema.Number.pipe(Schema.int(), Schema.between(0, 100)),
  reviewLimit: Schema.Number.pipe(Schema.int(), Schema.between(1, 1000)),
  additionalCards: Schema.Number.pipe(Schema.int(), Schema.between(0, 2000)),
});
export type WorkloadOptions = typeof OptionsSchema.Type;
export type WorkloadDay = {
  readonly day: number;
  readonly reviews: number;
  readonly introduced: number;
  readonly minutes: number;
  readonly backlog: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly buried: number;
};
export type WorkloadSimulation = {
  readonly days: readonly WorkloadDay[];
  readonly totalReviews: number;
  readonly totalMinutes: number;
  readonly expectedRetention: number | null;
  readonly averageSeconds: number;
  readonly timingEstimated: boolean;
  readonly targetRetention: number;
  readonly assumptions: readonly string[];
};
type SimCard = {
  readonly key: string;
  readonly areaId: string;
  readonly sibling?: string | undefined;
  readonly schedule: Assessment["schedule"];
};
/** Seeded scenario, never modifies schedules or creates review evidence. Uses device-local study-day boundaries, including daylight-saving transitions. */
export function simulateStudyWorkload(
  workspace: Workspace,
  now: number,
  input: unknown,
  areaId?: string,
): Effect.Effect<WorkloadSimulation, { readonly message: string }> {
  return Effect.gen(function* () {
    const invalid = {
      message:
        "Choose 1–180 days, 70–97% retention, 0–100 new cards/day, 1–1000 reviews/day and up to 2000 additional cards.",
    };
    const options = yield* Schema.decodeUnknown(OptionsSchema)(input).pipe(
      Effect.mapError(() => invalid),
    );
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(new Date(now).getTime()) ||
      !Number.isFinite(new Date(now + 181 * 86400000).getTime())
    )
      return yield* Effect.fail(invalid);
    const placement = reviewPlacement(workspace);
    const scope = areaId ? new Set(studyScope(workspace, areaId)) : undefined;
    const areas = workspace.areas.filter((area) => !scope || scope.has(area.id));
    const noteKeys = siblingNoteKeys(workspace);
    const cards: SimCard[] = areas.flatMap((area) =>
      area.cards
        .filter((card) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id))
        .map((card) => ({
          key: JSON.stringify([area.id, card.id]),
          areaId: area.id,
          sibling: siblingKey(card, area.id, noteKeys),
          schedule: card.schedule,
        })),
    );
    if (cards.length + options.additionalCards > 5000)
      return yield* Effect.fail({
        message: "Select a scope with at most 5000 cards including additional cards.",
      });
    const firstArea = areas[0];
    if (!firstArea && options.additionalCards)
      return yield* Effect.fail({
        message: "Create a subject before simulating additional cards.",
      });
    if (firstArea)
      for (let index = 0; index < options.additionalCards; index += 1)
        cards.push({
          key: `simulation:${String(index)}`,
          areaId: firstArea.id,
          schedule: newSchedule(new Date(now)),
        });
    const events = effectiveReviewEvents(workspace).filter(
      (event) =>
        (!scope || scope.has(placement.areaId(event))) &&
        Date.parse(event.effectiveReviewedAt ?? event.ratedAt) <= now,
    );
    const timed = events.flatMap((event) =>
      event.elapsedMs !== undefined &&
      event.elapsedMs !== null &&
      event.elapsedMs > 0 &&
      event.elapsedMs <= 600000
        ? [event.elapsedMs / 1000]
        : [],
    );
    const averageSeconds = timed.length
      ? timed.reduce((sum, seconds) => sum + seconds, 0) / timed.length
      : 15;
    const recalled = events.filter((event) => event.rating !== "again");
    const hard = recalled.length
      ? recalled.filter((event) => event.rating === "hard").length / recalled.length
      : 0.15;
    const easy = recalled.length
      ? recalled.filter((event) => event.rating === "easy").length / recalled.length
      : 0.1;
    let seed = 173;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const simulated = new Map(
      [...cards].sort((a, b) => a.key.localeCompare(b.key)).map((card) => [card.key, card]),
    );
    const days: WorkloadDay[] = [];
    let boundary = localStudyDay(now, workspace.schedulerSettings?.studyDayStartHour);
    let end = boundary.endsAt;
    for (let day = 0; day < options.days; day += 1) {
      const start = day === 0 ? now : boundary.startsAt;
      end = boundary.endsAt;
      const answered = new Set(
        events
          .filter((event) => {
            const at = Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
            return at >= boundary.startsAt && at <= start;
          })
          .map((event) => JSON.stringify([placement.areaId(event), event.cardId])),
      );
      const answeredSiblings = new Set(
        cards
          .filter((card) => answered.has(card.key))
          .flatMap((card) => (card.sibling ? [card.sibling] : [])),
      );
      const buried = new Set<string>();
      let reviews = 0;
      let clock = start;
      const introduced = new Set<string>();
      const queue = new SimulationHeap<SimCard>(
        (a, b) =>
          Date.parse(a.schedule.due) - Date.parse(b.schedule.due) || a.key.localeCompare(b.key),
      );
      for (const card of simulated.values())
        if (Date.parse(card.schedule.due) < end) queue.push(card);
      while (reviews < options.reviewLimit) {
        const current = queue.pop();
        if (!current) break;
        const policy = resolveStudySettings(workspace, current.areaId);
        const bury =
          current.schedule.state === 0
            ? policy.buryNewSiblings
            : current.schedule.state === 2
              ? policy.buryReviewSiblings
              : policy.buryLearningSiblings;
        if (
          (bury ?? policy.burySiblings ?? true) &&
          current.sibling &&
          answeredSiblings.has(current.sibling) &&
          !answered.has(current.key)
        ) {
          buried.add(current.key);
          continue;
        }
        if (current.schedule.state === 0 && introduced.size >= options.newPerDay) continue;
        clock = Math.max(clock, Date.parse(current.schedule.due));
        if (clock >= end) break;
        const parameters = {
          ...policy,
          requestRetention: options.retention,
        };
        const probability = recallProbability(current.schedule, new Date(clock), parameters) ?? 1;
        const choice = random();
        const rating =
          random() > probability
            ? "again"
            : choice < hard
              ? "hard"
              : choice > 1 - easy
                ? "easy"
                : "good";
        if (current.schedule.state === 0) introduced.add(current.key);
        const schedule = yield* Effect.try({
          try: () => scheduleReview(current.schedule, rating, new Date(clock), parameters),
          catch: () => ({ message: "This scheduling scenario could not be simulated." }),
        });
        const updated = { ...current, schedule };
        simulated.set(current.key, updated);
        answered.add(current.key);
        if (current.sibling) answeredSiblings.add(current.sibling);
        if (Date.parse(schedule.due) < end) queue.push(updated);
        clock += averageSeconds * 1000;
        reviews += 1;
      }
      days.push({
        day: day + 1,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        buried: buried.size,
        reviews,
        introduced: introduced.size,
        minutes: (reviews * averageSeconds) / 60,
        backlog: [...simulated.values()].filter(
          (card) => card.schedule.state !== 0 && Date.parse(card.schedule.due) < end,
        ).length,
      });
      boundary = localStudyDay(end, workspace.schedulerSettings?.studyDayStartHour);
    }
    const probabilities = [...simulated.values()].flatMap((card) => {
      const probability = recallProbability(
        card.schedule,
        new Date(end),
        resolveStudySettings(workspace, card.areaId),
      );
      return probability === null ? [] : [probability];
    });
    return {
      days,
      totalReviews: days.reduce((sum, day) => sum + day.reviews, 0),
      totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
      expectedRetention: probabilities.length
        ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length
        : null,
      averageSeconds,
      timingEstimated: timed.length === 0,
      targetRetention: options.retention,
      assumptions: [
        "The first study day starts now; later days use this device’s calendar and configured day-start hour, including daylight-saving changes.",
        "Sibling burying follows each subject’s policy; learning retries of the same card remain available.",
        "Reduced-load weekdays and policy time zones shift scheduled review due dates; they do not reduce the scenario’s daily answer limit.",
        "Limits below override daily budgets. Existing answers today, active search filters, and pause-new-when-overdue are not modeled.",
        "Seeded simulated answers estimate workload, not guaranteed recall. No review history or schedules are changed.",
      ],
    };
  });
}

/** Same starting collection, limits and random seed for each requested retention. */
export function compareStudyWorkload(
  workspace: Workspace,
  now: number,
  input: unknown,
  areaId?: string,
) {
  return Schema.decodeUnknown(OptionsSchema)(input).pipe(
    Effect.mapError(() => ({
      message: "Choose valid workload options before comparing retention.",
    })),
    Effect.flatMap((options) =>
      Effect.forEach(
        [...new Set([0.8, 0.9, 0.95, options.retention])].sort((a, b) => a - b),
        (retention) => simulateStudyWorkload(workspace, now, { ...options, retention }, areaId),
      ),
    ),
  );
}
