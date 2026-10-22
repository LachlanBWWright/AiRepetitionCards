import { Effect, Schema } from "effect";
import {
  AssessmentIdSchema,
  FilteredDeckSchema,
  ReviewEventIdSchema,
  type Workspace,
} from "@recall/domain";
import { validateStudyQuery } from "./card-search";
import { recordReview } from "../index-record-review";
export const RateFilteredCardSchema = Schema.Struct({
  kind: Schema.Literal("rate-filtered-card"),
  cardId: AssessmentIdSchema,
  eventId: ReviewEventIdSchema,
  rating: Schema.Literal("again", "hard", "good", "easy"),
  deck: FilteredDeckSchema,
});
export function rateFilteredCard(
  workspace: Workspace,
  command: typeof RateFilteredCardSchema.Type,
  now: Date,
) {
  return Effect.gen(function* () {
    const area = workspace.areas.find((item) =>
      item.cards.some((card) => card.id === command.cardId),
    );
    const invalid = {
      message:
        "This card is no longer available in the filtered collection. Rebuild the collection.",
    };
    if (!area || command.deck.mode !== "reschedule") return yield* Effect.fail(invalid);
    if (command.deck.areaId && command.deck.areaId !== area.id) return yield* Effect.fail(invalid);
    yield* validateStudyQuery(command.deck.query);
    // Membership is captured when the session starts: an Again answer must remain repeatable
    // even when it no longer matches is:new or is:due after its first answer.
    return yield* recordReview({
      workspace,
      areaId: area.id,
      cardId: command.cardId,
      eventId: command.eventId,
      rating: command.rating,
      ratedAt: now.toISOString(),
    }).pipe(
      Effect.mapError(() => invalid),
      Effect.map((result) => result.workspace),
    );
  });
}
