import { Effect, Either, Schema } from "effect";
import {
  AreaIdSchema,
  CardIdSchema,
  ReviewEventIdSchema,
  ReviewEventSchema,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { scheduleReview, type ReviewRating } from "@recall/scheduler";
import { createSyncedReviewEvent } from "@recall/sync-core";

export { clearWorkspace, loadWorkspace, saveWorkspace } from "./workspace-persistence";
export { fromKnowledgeArea, toKnowledgeArea } from "./knowledge-area-interchange";
export { exportDelimitedCards, importDelimitedCards } from "./delimited-interchange";
export type { DelimitedImportError, DelimitedImportResult } from "./delimited-interchange";
export { importAnkiApkg } from "./anki-import";
export type {
  AnkiCardRow,
  AnkiCollection,
  AnkiImportError,
  AnkiImportProposal,
  AnkiNoteRow,
  AnkiNoteType,
  AnkiSqliteReader,
  AnkiSqliteReaderError,
} from "./anki-import";
export {
  exportKnowledgeAreaPackage,
  importKnowledgeAreaPackage,
  isSupportedMediaContent,
  verifyMediaAsset,
} from "./knowledge-area-package";
export type {
  ImportedKnowledgeAreaPackage,
  KnowledgeAreaPackageFailure,
} from "./knowledge-area-package";
export {
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
} from "./workspace-backup-package";
export { persistMediaAssets } from "./media-persistence";
export type { MediaPersistenceFailure } from "./media-persistence";
export type { RestoredWorkspaceBackup, WorkspaceBackupFailure } from "./workspace-backup-package";
export { createTutorApi } from "./tutor-api";
export type {
  TutorApiFailure,
  TutorHttpRequest,
  TutorHttpResponse,
  TutorTransport,
  TutorTransportError,
} from "./tutor-api";
export type {
  KnowledgeAreaExportError,
  KnowledgeAreaImportError,
} from "./knowledge-area-interchange";

export type RecordReviewFailure =
  | { readonly _tag: "ReviewAreaNotFound"; readonly areaId: string }
  | { readonly _tag: "ReviewCardNotFound"; readonly cardId: string }
  | { readonly _tag: "ReviewEventAlreadyExists"; readonly eventId: string }
  | { readonly _tag: "ReviewTimestampInvalid" }
  | { readonly _tag: "ReviewIdentifierInvalid"; readonly identifier: "area" | "card" | "event" }
  | { readonly _tag: "ReviewEventInvalid" }
  | { readonly _tag: "ReviewScheduleUnavailable" };

export type RecordReviewInput = {
  readonly workspace: Workspace;
  readonly areaId: unknown;
  readonly cardId: unknown;
  readonly rating: ReviewRating;
  readonly eventId: unknown;
  readonly ratedAt: string;
};

export type RecordReviewResult = {
  readonly workspace: Workspace;
  readonly event: ReviewEvent;
};

export function recordReview(
  input: RecordReviewInput,
): Effect.Effect<RecordReviewResult, RecordReviewFailure> {
  return Effect.gen(function* () {
    const areaId = Schema.decodeUnknownEither(AreaIdSchema)(input.areaId);
    if (Either.isLeft(areaId)) {
      return yield* Effect.fail({ _tag: "ReviewIdentifierInvalid", identifier: "area" } as const);
    }
    const cardId = Schema.decodeUnknownEither(CardIdSchema)(input.cardId);
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

    const decodedEvent = Schema.decodeUnknownEither(ReviewEventSchema)({
      id: eventId.right,
      areaId: area.id,
      cardId: card.id,
      ratedAt: new Date(ratedAtTime).toISOString(),
      rating: input.rating,
      schedulerFamily: "fsrs",
      schedulerVersion: "ts-fsrs@5.4.2",
    });
    if (Either.isLeft(decodedEvent))
      return yield* Effect.fail({ _tag: "ReviewEventInvalid" } as const);

    const nextSchedule = yield* Effect.try({
      try: () => scheduleReview(card.schedule, input.rating, new Date(ratedAtTime)),
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
          currentArea.id !== area.id
            ? currentArea
            : {
                ...currentArea,
                cards: currentArea.cards.map((currentCard) =>
                  currentCard.id === card.id
                    ? { ...currentCard, schedule: nextSchedule }
                    : currentCard,
                ),
              },
        ),
      },
    };
  });
}
