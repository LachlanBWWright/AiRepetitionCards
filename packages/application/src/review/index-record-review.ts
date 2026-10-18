import { Effect, Either, Schema } from "effect";
import {
  AreaIdSchema,
  AssessmentIdSchema,
  ReviewEventIdSchema,
  ReviewEventSchema,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import {
  DEFAULT_SCHEDULER_PARAMETERS,
  scheduleReview,
  schedulerParameterSetId,
  type ReviewRating,
} from "@recall/scheduler";
import { createSyncedReviewEvent } from "@recall/sync-core";
import { reviewScheduleHash } from "./review-schedule-hash";

export type RecordReviewFailure =
  | { readonly _tag: "ReviewAreaNotFound"; readonly areaId: string }
  | { readonly _tag: "ReviewCardNotFound"; readonly cardId: string }
  | { readonly _tag: "ReviewEventAlreadyExists"; readonly eventId: string }
  | { readonly _tag: "ReviewTimestampInvalid" }
  | { readonly _tag: "ReviewIdentifierInvalid"; readonly identifier: "area" | "card" | "event" }
  | { readonly _tag: "ReviewEventInvalid" }
  | { readonly _tag: "ReviewElapsedTimeInvalid" }
  | { readonly _tag: "ReviewScheduleUnavailable" };

export type RecordReviewInput = {
  readonly workspace: Workspace;
  readonly areaId: unknown;
  readonly cardId: unknown;
  readonly rating: ReviewRating;
  readonly eventId: unknown;
  readonly ratedAt: string;
  readonly elapsedMs?: unknown;
};

export type RecordReviewResult = {
  readonly workspace: Workspace;
  readonly event: ReviewEvent;
};

function updateReviewedAreaSchedule(
  area: Workspace["areas"][number],
  cardId: string,
  schedule: Workspace["areas"][number]["cards"][number]["schedule"],
): Workspace["areas"][number] {
  return {
    ...area,
    cards: area.cards.map((currentCard) =>
      currentCard.id === cardId ? { ...currentCard, schedule } : currentCard,
    ),
  };
}

export function recordReview(
  input: RecordReviewInput,
): Effect.Effect<RecordReviewResult, RecordReviewFailure> {
  return Effect.gen(function* () {
    const areaId = Schema.decodeUnknownEither(AreaIdSchema)(input.areaId);
    if (Either.isLeft(areaId)) {
      return yield* Effect.fail({ _tag: "ReviewIdentifierInvalid", identifier: "area" } as const);
    }
    const cardId = Schema.decodeUnknownEither(AssessmentIdSchema)(input.cardId);
    if (Either.isLeft(cardId)) {
      return yield* Effect.fail({ _tag: "ReviewIdentifierInvalid", identifier: "card" } as const);
    }
    const eventId = Schema.decodeUnknownEither(ReviewEventIdSchema)(input.eventId);
    if (Either.isLeft(eventId)) {
      return yield* Effect.fail({ _tag: "ReviewIdentifierInvalid", identifier: "event" } as const);
    }
    const area = input.workspace.areas.find((item) => item.id === areaId.right);
    if (!area)
      return yield* Effect.fail({ _tag: "ReviewAreaNotFound", areaId: areaId.right } as const);
    const card = area.cards.find((item) => item.id === cardId.right);
    if (!card)
      return yield* Effect.fail({ _tag: "ReviewCardNotFound", cardId: cardId.right } as const);
    const previousEvents = input.workspace.reviewEvents ?? [];
    if (previousEvents.some((event) => event.id === eventId.right)) {
      return yield* Effect.fail({
        _tag: "ReviewEventAlreadyExists",
        eventId: eventId.right,
      } as const);
    }
    const ratedAtTime = Date.parse(input.ratedAt);
    if (!Number.isFinite(ratedAtTime))
      return yield* Effect.fail({ _tag: "ReviewTimestampInvalid" } as const);

    const elapsedMs = Schema.decodeUnknownEither(
      Schema.NullOr(
        Schema.Number.pipe(
          Schema.int(),
          Schema.nonNegative(),
          Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
        ),
      ),
    )(input.elapsedMs === undefined ? null : input.elapsedMs);
    if (Either.isLeft(elapsedMs))
      return yield* Effect.fail({ _tag: "ReviewElapsedTimeInvalid" } as const);
    const previousStateHash = yield* reviewScheduleHash(card.schedule).pipe(
      Effect.mapError(() => ({ _tag: "ReviewScheduleUnavailable" }) as const),
    );

    const parameters = input.workspace.schedulerSettings ?? DEFAULT_SCHEDULER_PARAMETERS;
    const decodedEvent = Schema.decodeUnknownEither(ReviewEventSchema)({
      id: eventId.right,
      areaId: area.id,
      cardId: card.id,
      ratedAt: new Date(ratedAtTime).toISOString(),
      rating: input.rating,
      schedulerFamily: "fsrs",
      schedulerVersion: "ts-fsrs@5.4.2",
      schedulerParameterSetId: schedulerParameterSetId(parameters),
      previousStateHash,
      elapsedMs: elapsedMs.right,
    });
    if (Either.isLeft(decodedEvent))
      return yield* Effect.fail({ _tag: "ReviewEventInvalid" } as const);

    const nextSchedule = yield* Effect.try({
      try: () => scheduleReview(card.schedule, input.rating, new Date(ratedAtTime), parameters),
      catch: () => ({ _tag: "ReviewScheduleUnavailable" }) as const,
    });
    const event = createSyncedReviewEvent(input.workspace, decodedEvent.right);
    const pending = new Set(input.workspace.pendingReviewEventIds ?? []);
    pending.add(event.id);
    return {
      event,
      workspace: {
        ...input.workspace,
        reviewEvents: [...previousEvents, event],
        pendingReviewEventIds: [...pending],
        reviews: Math.max(input.workspace.reviews, previousEvents.length) + 1,
        areas: input.workspace.areas.map((currentArea) =>
          currentArea.id === area.id
            ? updateReviewedAreaSchedule(currentArea, card.id, nextSchedule)
            : currentArea,
        ),
      },
    };
  });
}
