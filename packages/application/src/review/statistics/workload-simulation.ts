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
};
export type WorkloadSimulation = {
  readonly days: readonly WorkloadDay[];
  readonly totalReviews: number;
  readonly totalMinutes: number;
  readonly expectedRetention: number | null;
  readonly averageSeconds: number;
  readonly timingEstimated: boolean;
};
type SimCard = {
  readonly key: string;
  readonly areaId: string;
  readonly schedule: Assessment["schedule"];
};
/** Seeded scenario, never modifies schedules or creates review evidence. A day is 24 hours. */
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
    if (!Number.isFinite(now)) return yield* Effect.fail(invalid);
    const placement = reviewPlacement(workspace);
    const scope = areaId ? new Set(studyScope(workspace, areaId)) : undefined;
    const areas = workspace.areas.filter((area) => !scope || scope.has(area.id));
    const cards: SimCard[] = areas.flatMap((area) =>
      area.cards
        .filter((card) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id))
        .map((card) => ({ key: card.id, areaId: area.id, schedule: card.schedule })),
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
    for (let day = 0; day < options.days; day += 1) {
      const start = now + day * 86400000,
        end = start + 86400000;
      const admitted = new Set(
        [...simulated.values()]
          .filter((card) => card.schedule.state === 0)
          .slice(0, options.newPerDay)
          .map((card) => card.key),
      );
      let reviews = 0;
      let clock = start;
      const introduced = new Set<string>();
      const queue = new SimulationHeap<SimCard>(
        (a, b) =>
          Date.parse(a.schedule.due) - Date.parse(b.schedule.due) || a.key.localeCompare(b.key),
      );
      for (const card of simulated.values())
        if (
          (card.schedule.state !== 0 || admitted.has(card.key)) &&
          Date.parse(card.schedule.due) < end
        )
          queue.push(card);
      while (reviews < options.reviewLimit) {
        const current = queue.pop();
        if (!current) break;
        clock = Math.max(clock, Date.parse(current.schedule.due));
        if (clock >= end) break;
        const parameters = {
          ...resolveStudySettings(workspace, current.areaId),
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
        if (Date.parse(schedule.due) < end) queue.push(updated);
        clock += averageSeconds * 1000;
        reviews += 1;
      }
      days.push({
        day: day + 1,
        reviews,
        introduced: introduced.size,
        minutes: (reviews * averageSeconds) / 60,
        backlog: [...simulated.values()].filter(
          (card) => card.schedule.state !== 0 && Date.parse(card.schedule.due) < end,
        ).length,
      });
    }
    const end = now + options.days * 86400000;
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
    };
  });
}
