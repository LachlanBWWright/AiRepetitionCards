import { Effect, Either, Schema } from "effect";
import {
  AreaIdSchema,
  CardIdSchema,
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
export {
  reviewScheduleHash,
  REVIEW_SCHEDULE_HASH_VERSION,
  type ReviewScheduleHashInvalid,
} from "./review-schedule-hash";

export { publicationFailureMessage } from "./publishing-errors";
export {
  bindWorkspaceOwner,
  workspaceHasRemoteSyncMetadata,
  workspaceAccountFailureMessage,
} from "./workspace-account";

export {
  clearWorkspace,
  clearWorkspaceAndMedia,
  loadWorkspace,
  saveWorkspace,
  saveWorkspaceWithMedia,
} from "./workspace-persistence";
export type {
  WorkspaceMediaClearResult,
  WorkspaceMediaCommitFailure,
} from "./workspace-persistence";
export { expandCloze, renderCloze, renderClozeCard, MAX_CLOZE_TEXT_LENGTH } from "./cloze";
export type { ClozeFailure, RenderedCloze } from "./cloze";
export { fromKnowledgeArea, toKnowledgeArea } from "./knowledge-area-interchange";
export { diffKnowledgeAreas } from "./knowledge-area-diff";
export { AreaSettingsSchema, updateAreaSettings } from "./area-settings";
export { deleteLearningArea, saveLearningArea } from "./area-management";
export type { AreaDeletionResult, AreaManagementFailure } from "./area-management";
export type { AreaSettings, AreaSettingsFailure } from "./area-settings";
export { updateSchedulerSettings } from "./scheduler-settings";
export type { SchedulerSettingsFailure } from "./scheduler-settings";
export { summarizeReviews } from "./review-insights";
export type { ReviewInsights } from "./review-insights";
export { rebuildWorkspaceSchedules } from "./schedule-replay";
export type {
  KnowledgeAreaDiff,
  KnowledgeAreaDiffFailure,
  KnowledgeAreaEntityChanges,
  KnowledgeAreaMetadataChange,
  KnowledgeAreaMetadataField,
} from "./knowledge-area-diff";
export { exportDelimitedCards, importDelimitedCards } from "./delimited-interchange";
export type { DelimitedImportError, DelimitedImportResult } from "./delimited-interchange";
export { importAnkiApkg } from "./anki-import";
export { decodeAnkiV18Collection } from "./anki-v18";
export type { AnkiV18CollectionRows } from "./anki-v18";
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
  MAX_KNOWLEDGE_AREA_PACKAGE_BYTES,
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
export { createWorkspaceMediaGateway, syncWorkspaceMedia } from "./workspace-media-sync";
export type {
  WorkspaceMediaGateway,
  WorkspaceMediaGatewayFailure,
  WorkspaceMediaHttpRequest,
  WorkspaceMediaHttpResponse,
  WorkspaceMediaSyncFailure,
  WorkspaceMediaTransport,
  WorkspaceMediaTransportFailure,
} from "./workspace-media-sync";
export { createPublishedMediaGateway } from "./published-media";
export type {
  PublishedMediaFailure,
  PublishedMediaGateway,
  PublishedMediaHttpRequest,
  PublishedMediaHttpResponse,
  PublishedMediaTransport,
  PublishedMediaTransportFailure,
} from "./published-media";
export type { RestoredWorkspaceBackup, WorkspaceBackupFailure } from "./workspace-backup-package";
export { createTutorApi, tutorApiFailureMessage } from "./tutor-api";
export type {
  TutorApiFailure,
  TutorHttpRequest,
  TutorHttpResponse,
  TutorTransport,
  TutorTransportError,
} from "./tutor-api";
export { canonicalPublicationJson, publicationContentHash } from "./publication-content-hash";
export { createPublishingApi } from "./publishing-api";
export type {
  PublishingApi,
  PublishingApiFailure,
  PublishingHttpRequest,
  PublishingHttpResponse,
  PublishingTransport,
  PublishingTransportFailure,
} from "./publishing-api";
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

export { exportAccountData, deleteAccountData } from "./account";
export type { AccountApi, AccountRequestFailure, AccountActionFailure } from "./account";

export { createStudyCard, updateStudyCard, deleteStudyCard } from "./card-management";
export type { CardContent, CardManagementFailure } from "./card-management";
export { recordHttpTelemetry } from "./http-telemetry";
export type { HttpTelemetryFailure, HttpTelemetrySink } from "./http-telemetry";

export { checkApiRateLimit, ApiRateLimitScopeSchema } from "./rate-limit";
export type {
  ApiRateLimitScope,
  ApiRateLimitStore,
  ApiRateLimitPolicy,
  ApiRateLimitDecision,
  ApiRateLimitFailure,
} from "./rate-limit";

export * from "./tutor-privacy";
export {
  preparePublication,
  publicationNeedsReuseConfirmation,
  createPublicationFork,
  publicationForkIdentity,
  pendingPublicationForkOperation,
} from "./publication-fork";
export type {
  PublicationPreparationFailure,
  PublicationForkFailure,
  PublicationForkOperationStore,
  PublicationForkOperationFailure,
} from "./publication-fork";

export {
  syncWorkspace,
  applyWorkspaceSyncChanges,
  applyWorkspaceContentConflict,
} from "./workspace-sync";
export type {
  WorkspaceContentConflict,
  WorkspaceSyncInput,
  WorkspaceSyncResult,
  WorkspaceSyncChanges,
  WorkspaceSyncFailure,
  WorkspaceSyncCheckpointFailure,
  WorkspaceSyncRequest,
  WorkspaceSyncResponse,
  WorkspaceSyncTransport,
  WorkspaceSyncTransportFailure,
} from "./workspace-sync";

export {
  executeTutorWorkflow,
  prepareTutorWorkflow,
  resolveTutorWorkflowProposal,
  validateTutorProposalResolution,
  type PreparedTutorWorkflow,
  type TutorWorkflowFailure,
  type TutorWorkflowProvider,
  type TutorWorkflowSnapshot,
  type TutorWorkflowTransition,
} from "./tutor-workflow";

export {
  prepareTutorCardApproval,
  persistTutorCardApproval,
  type TutorApprovalFailure,
} from "./tutor-approval";
export {
  pendingPublicationOperation,
  publicationOperationIdentity,
  publicationRequestFingerprint,
  encodePublicationShareToken,
  type PublicationOperationStore,
  type PublicationOperationFailure,
} from "./publication-operation";
export { tutorAreaFingerprint } from "./tutor-context-transport";
export {
  accumulateTutorObservations,
  selectTutorQuizObjective,
  type TutorEvidenceFailure,
} from "./tutor-objective-selection";

export {
  retainedReviewContent,
  retainReviewDeletionContent,
  releaseRetainedReviewContent,
  validateRetainedReviewContent,
} from "./review-deletion-retention";
export type { ReviewDeletionRetentionFailure } from "./review-deletion-retention";
export {
  WorkspaceAuthoringCommandSchema,
  applyWorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
} from "./workspace-authoring";
export type {
  WorkspaceAuthoringCommand,
  WorkspaceAuthoringFailure,
  WorkspaceAuthoringResult,
} from "./workspace-authoring";

export {
  AiUsageReservationRequestSchema,
  AiUsageReservationSchema,
  reserveAiUsage,
  settleAiUsage,
} from "./ai-usage-budget";
export type {
  AiUsageBudget,
  AiUsageBudgetFailure,
  AiUsageReservationRequest,
  AiUsageReservation,
  AiUsageSettlement,
} from "./ai-usage-budget";

export { formatTagInput, parseTagInput } from "./tag-input";
export type { TagInputFailure } from "./tag-input";

export {
  LocalAiUsageStateSchema,
  LocalAiUsagePolicySchema,
  LocalAiUsageEntrySchema,
  LocalAiUsageSummarySchema,
  LocalAiUsageSnapshotSchema,
  LocalAiUsageReservationSchema,
  LocalAiUsageSettlementSchema,
  emptyLocalAiUsageState,
  defaultLocalAiUsagePolicy,
  reserveLocalAiUsage,
  settleLocalAiUsage,
  updateLocalAiUsagePolicy,
  summarizeLocalAiUsage,
} from "./local-ai-usage";
export type {
  LocalAiUsageState,
  LocalAiUsagePolicy,
  LocalAiUsageEntry,
  LocalAiUsageSummary,
  LocalAiUsageSnapshot,
  LocalAiUsageReservation,
  LocalAiUsageSettlement,
  LocalAiUsageInvalid,
  LocalAiBudgetExceeded,
} from "./local-ai-usage";

export * from "./knowledge-notebook";
export { createKnowledgeNotebookTutor } from "./knowledge-notebook-tutor";
export type { NotebookTutorFailure } from "./knowledge-notebook-tutor";
export * from "./study-materials";

export { createStudyMaterialsTutor } from "./study-materials-tutor";
export * from "./local-ai-budget-service";

export {
  DailyReminderSettingsSchema,
  defaultDailyReminderSettings,
  validateDailyReminderSettings,
  type DailyReminderSettings,
} from "./daily-reminders";
