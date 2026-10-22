import { reviewPlacement, effectiveReviewEvents, type Workspace } from "@recall/domain";
import { Effect } from "effect";
import { rescheduleDueDate } from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import { resolveStudySettings } from "../presets/resolve-settings";

/** Append due-date adjustments only where effective scheduling parameters changed. */
export function rescheduleChangedParameters(
  previous: Workspace,
  next: Workspace,
  now: Date,
): Effect.Effect<Workspace, { readonly message: string }> {
  return Effect.gen(function* () {
    const failure = { message: "Due dates could not be recalculated. No settings were saved." };
    if (!Number.isFinite(now.getTime())) return yield* Effect.fail(failure);
    const adjustments = [...(next.scheduleAdjustments ?? [])];
    const placement = reviewPlacement(next);
    const events = orderReviewEvents(effectiveReviewEvents(next)).events;
    const latest = new Map(events.map((event) => [placement.key(event), event.id]));
    const recordedTimes = new Map<string, number>();
    for (const adjustment of adjustments) {
      const key = placement.key(adjustment);
      recordedTimes.set(
        key,
        Math.max(recordedTimes.get(key) ?? -Infinity, Date.parse(adjustment.recordedAt)),
      );
    }
    const areas = [];
    for (const area of next.areas) {
      const before = resolveStudySettings(previous, area.id);
      const after = resolveStudySettings(next, area.id);
      const changed =
        before.requestRetention !== after.requestRetention ||
        JSON.stringify(before.weights) !== JSON.stringify(after.weights) ||
        before.maximumInterval !== after.maximumInterval ||
        JSON.stringify(before.easyDays) !== JSON.stringify(after.easyDays) ||
        before.timeZone !== after.timeZone;
      if (!changed || !after.rescheduleOnParameterChange) {
        areas.push(area);
        continue;
      }
      const cards = [];
      let processed = 0;
      for (const card of area.cards) {
        if (processed++ % 256 === 0) yield* Effect.yieldNow();
        const due = yield* rescheduleDueDate(card.schedule, after).pipe(
          Effect.mapError(() => failure),
        );
        if (due === card.schedule.due) {
          cards.push(card);
          continue;
        }
        const key = placement.key({ areaId: area.id, cardId: card.id });
        const recordedAt = new Date(
          Math.max(
            now.getTime(),
            Date.parse(card.schedule.last_review ?? now.toISOString()) + 1,
            (recordedTimes.get(key) ?? -Infinity) + 1,
          ),
        ).toISOString();
        recordedTimes.set(key, Date.parse(recordedAt));
        adjustments.push({
          id: `parameters:${recordedAt}:${area.id}:${card.id}`,
          areaId: area.id,
          cardId: card.id,
          afterReviewEventId:
            latest.get(placement.key({ areaId: area.id, cardId: card.id })) ?? null,
          recordedAt,
          kind: "due",
          due,
        });
        cards.push({ ...card, schedule: { ...card.schedule, due } });
      }
      areas.push({ ...area, cards });
    }
    return { ...next, areas, scheduleAdjustments: adjustments };
  });
}
