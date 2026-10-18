"use client";

import { Either } from "effect";
import { KnowledgeAreaPublishingReleasePreview } from "./KnowledgeAreaPublishingReleasePreview";
import { useKnowledgeAreaPublishingActions } from "./workflows/useKnowledgeAreaPublishingActions";
import { useKnowledgeAreaPublishingState } from "./workflows/useKnowledgeAreaPublishingState";
import { KnowledgeAreaPublishingView } from "./KnowledgeAreaPublishingView";
import { browserForkOperationStore } from "@/lib/publishing/fork-operation-store";
import {
  browserPublicationOperationStore,
  createPublicationShareToken,
} from "@/lib/publishing/publication-operation-store";
import { publishedMediaGateway } from "@/features/workspace/published-media-api";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { publishingApi } from "@/lib/publishing-api";
import type { KnowledgeAreaPublishingProps } from "./KnowledgeAreaPublishingTypes";
import { KnowledgeAreaPublishingPublishForm } from "./forms/KnowledgeAreaPublishingPublishForm";
import { KnowledgeAreaPublishingMetadataFields } from "./forms/KnowledgeAreaPublishingMetadataFields";
import { KnowledgeAreaPublishingLicenseFields } from "./forms/KnowledgeAreaPublishingLicenseFields";
import { KnowledgeAreaPublishingReleaseStatus } from "./KnowledgeAreaPublishingReleaseStatus";
import { KnowledgeAreaPublishingSubmitButton } from "./forms/KnowledgeAreaPublishingSubmitButton";
import { KnowledgeAreaPublishingShareLink } from "./forms/KnowledgeAreaPublishingShareLink";
import { KnowledgeAreaPublishingShareControls } from "./forms/KnowledgeAreaPublishingShareControls";

export function KnowledgeAreaPublishing({
  area,
  embedded = false,
  lineageArea,
  onFork,
  onUpdate,
  transport = publishingApi,
  mediaGateway = publishedMediaGateway,
  mediaStore = browserMediaStore,
  initialPublication,
  initialRequest,
  forkOperationStore = browserForkOperationStore,
  createForkOperationId = () => crypto.randomUUID(),
  publicationOperationStore = browserPublicationOperationStore,
  releaseDraftScope = "local",
  retainDraftsOnDevice = false,
  createPublishShareToken = createPublicationShareToken,
  initialPublishRecovery,
  initialForkRecovery,
  initialUpstreamUpdate,
}: KnowledgeAreaPublishingProps) {
  const state = useKnowledgeAreaPublishingState({
    area,
    lineageArea,
    initialUpstreamUpdate,
    initialRequest,
    initialPublication,
    initialPublishRecovery,
    initialForkRecovery,
    releaseDraftScope,
    retainDraftsOnDevice,
    publicationOperationStore,
    transport,
    mediaStore,
  });
  const actions = useKnowledgeAreaPublishingActions({
    state,
    onFork,
    forkOperationStore,
    createForkOperationId,
    createPublishShareToken,
    mediaGateway,
  });

  const publishForm = area ? (
    <KnowledgeAreaPublishingPublishForm
      title={area.title}
      embedded={embedded}
      onPublish={() => void actions.publish()}
    >
      <KnowledgeAreaPublishingMetadataFields
        visibility={state.visibility}
        onVisibilityChange={state.setVisibility}
        releaseNotes={state.releaseNotes}
        onReleaseNotesChange={state.setReleaseNotes}
        attribution={state.attribution}
        onAttributionChange={state.setAttribution}
      />
      <KnowledgeAreaPublishingLicenseFields
        difficulty={state.difficulty}
        onDifficultyChange={state.setDifficulty}
        license={state.license}
        onLicenseChange={(value) => {
          state.setLicense(value === "none" ? "" : value);
          state.setReuseConfirmed(false);
        }}
        needsReuseConfirmation={state.needsReuseConfirmation}
        reuseConfirmed={state.reuseConfirmed}
        onReuseConfirmedChange={state.setReuseConfirmed}
      />
      <KnowledgeAreaPublishingReleaseStatus
        preview={
          state.releasePreview && Either.isRight(state.releasePreview) ? (
            <KnowledgeAreaPublishingReleasePreview
              comparison={state.releasePreview.right.diff}
              warnings={state.releasePreview.right.warnings}
            />
          ) : null
        }
        issues={state.qualityIssues}
        qualityStatus={state.qualityResult?.status ?? null}
      />
      <KnowledgeAreaPublishingSubmitButton
        busy={state.busy}
        blocked={state.hasQualityBlockers}
        license={state.license}
        needsReuseConfirmation={state.needsReuseConfirmation}
        reuseConfirmed={state.reuseConfirmed}
      />
      <KnowledgeAreaPublishingShareLink
        embedded={embedded}
        url={state.shareUrl}
        path={state.sharePath}
        origin={state.shareOrigin}
        visibility={state.publishedVisibility}
        onCopy={() => void actions.copyShareLink()}
      />
      {state.ownsPublication &&
        state.publishedVersionId &&
        state.publishedVisibility === "unlisted" && (
          <KnowledgeAreaPublishingShareControls
            embedded={embedded}
            busy={state.busy}
            shareToken={state.shareToken}
            manageShareToken={actions.manageShareToken}
          />
        )}
    </KnowledgeAreaPublishingPublishForm>
  ) : null;
  const receivePanelProps = {
    embedded,
    upstreamArea: state.upstreamArea,
    busy: state.busy,
    checkUpstreamUpdates: actions.checkUpstreamUpdates,
    upstreamUpdate: state.upstreamUpdate,
    setBusy: state.setBusy,
    setToken: state.setToken,
    readPreview: actions.readPreview,
    versionId: state.versionId,
    token: state.token,
    setVersionId: state.setVersionId,
    receive: actions.receive,
    publication: state.publication,
    lineageArea,
    comparison: state.comparison,
    comparisonFailed: state.comparisonFailed,
    area,
    onUpdate,
    transport,
    mediaGateway,
    fork: actions.fork,
  };

  return (
    <KnowledgeAreaPublishingView
      embedded={embedded}
      area={area}
      busy={state.busy}
      forkConflict={state.forkConflict && state.publication !== null}
      publicationConflict={state.publicationConflict}
      notice={state.notice}
      publishForm={publishForm}
      receivePanelProps={receivePanelProps}
      startNewForkAttempt={actions.clearForkAttempt}
      startNewPublicationAttempt={actions.clearPublicationAttempt}
    />
  );
}
