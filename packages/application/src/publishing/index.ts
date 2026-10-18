export { publicationFailureMessage } from "./publishing-errors";

export { diffKnowledgeAreas } from "./knowledge-area-diff";

export {
  previewRelease,
  readReleaseDraft,
  writeReleaseDraft,
  releaseDraftForArea,
  readReleaseBaseline,
  writeReleaseBaseline,
  withReleaseDifficulty,
  scopeReleaseDraftStore,
} from "./release-draft";

export type {
  ReleaseDraft,
  ReleaseDraftStore,
  ReleaseDraftFailure,
  ReleasePreview,
} from "./release-draft";

export { createDeckSharingApi } from "./deck-sharing-api";

export type {
  DeckSharingApi,
  DeckSharingFailure,
  DeckSharingTransport,
  DeckSharingHttpRequest,
  DeckSharingHttpResponse,
} from "./deck-sharing-api";

export { applySelectedDeckUpdate } from "./deck-updates";

export type { DeckUpdateFailure, DeckUpdateInput, DeckUpdateResult } from "./deck-updates";

export { applyDeckWorkspaceUpdate } from "./apply-deck-workspace-update";

export type { ApplyDeckWorkspaceUpdateFailure } from "./apply-deck-workspace-update";

export { retainPublishedActivityDefinitions } from "./published-activity-library";

export type {
  KnowledgeAreaDiff,
  KnowledgeAreaDiffFailure,
  KnowledgeAreaEntityChanges,
  KnowledgeAreaMetadataChange,
  KnowledgeAreaMetadataField,
} from "./knowledge-area-diff";

export { createPublishedMediaGateway } from "./published-media";

export type {
  PublishedMediaFailure,
  PublishedMediaGateway,
  PublishedMediaHttpRequest,
  PublishedMediaHttpResponse,
  PublishedMediaTransport,
  PublishedMediaTransportFailure,
} from "./published-media";

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

export {
  preparePublication,
  publicationNeedsReuseConfirmation,
  createPublicationFork,
  publicationForkIdentity,
  PublicationForkIdKind,
  pendingPublicationForkOperation,
} from "./publication-fork";

export type {
  PublicationPreparationFailure,
  PublicationForkFailure,
  PublicationForkOperationStore,
  PublicationForkOperationFailure,
} from "./publication-fork";

export {
  pendingPublicationOperation,
  publicationOperationIdentity,
  publicationRequestFingerprint,
  encodePublicationShareToken,
  type PublicationOperationStore,
  type PublicationOperationFailure,
} from "./publication-operation";

export * from "./release-draft";
