import { Effect, Either } from "effect";
import {
  pendingPublicationOperation,
  publicationFailureMessage,
  verifyMediaAsset,
  writeReleaseBaseline,
  scopeReleaseDraftStore,
  type PublicationOperationStore,
  type PublishedMediaGateway,
  type PublishingApi,
  type ReleaseDraftStore,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";

type PublishWorkflowDependencies = {
  readonly area: KnowledgeArea | null | undefined;
  readonly hasQualityBlockers: boolean;
  readonly license: string;
  readonly needsReuseConfirmation: boolean;
  readonly reuseConfirmed: boolean;
  readonly setNotice: (notice: string | null) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly mediaStore: MediaStore;
  readonly mediaGateway: PublishedMediaGateway;
  readonly releaseContent: KnowledgeArea | null;
  readonly visibility: "unlisted" | "public";
  readonly releaseNotes: string;
  readonly attribution: string;
  readonly publicationOperationStore: PublicationOperationStore;
  readonly createForkOperationId: () => string;
  readonly createPublishShareToken: () => string;
  readonly transport: PublishingApi;
  readonly releaseDraftStore: ReleaseDraftStore;
  readonly releaseDraftScope: string;
  readonly setPublicationConflict: (conflict: boolean) => void;
  readonly setVersionId: (versionId: string) => void;
  readonly setToken: (token: string) => void;
  readonly setShareToken: (token: string | null) => void;
  readonly setOwnsPublication: (owns: boolean) => void;
  readonly setPublishedVersionId: (versionId: string) => void;
  readonly setPublishedVisibility: (visibility: "private" | "unlisted" | "public") => void;
  readonly setPreviousReleaseRecord: (record: {
    readonly areaId: string;
    readonly value: KnowledgeArea;
  }) => void;
};

export async function runKnowledgeAreaPublishingPublishWorkflow(
  dependencies: PublishWorkflowDependencies,
): Promise<void> {
  const {
    area,
    hasQualityBlockers,
    license,
    needsReuseConfirmation,
    reuseConfirmed,
    setNotice,
    setBusy,
    mediaStore,
    mediaGateway,
    releaseContent,
    visibility,
    releaseNotes,
    attribution,
    publicationOperationStore,
    createForkOperationId,
    createPublishShareToken,
    transport,
    releaseDraftStore,
    releaseDraftScope,
    setPublicationConflict,
    setVersionId,
    setToken,
    setShareToken,
    setOwnsPublication,
    setPublishedVersionId,
    setPublishedVisibility,
    setPreviousReleaseRecord,
  } = dependencies;
  if (!area || hasQualityBlockers) {
    if (hasQualityBlockers) setNotice("Fix the publishing blockers before publishing this area.");
    return;
  }
  if (!license.trim() || (needsReuseConfirmation && !reuseConfirmed)) {
    setNotice("Choose a license and confirm you have permission to share this content.");
    return;
  }
  setBusy(true);
  setNotice(null);
  const references = [
    ...new Map(
      area.cards.flatMap((card) => card.media ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  for (const reference of references) {
    const local = await Effect.runPromise(Effect.either(mediaStore.get(reference.id)));
    if (Either.isLeft(local) || !local.right || !verifyMediaAsset(local.right)) {
      setNotice(
        "An attachment is missing or failed integrity validation. The area was not published.",
      );
      setBusy(false);
      return;
    }
    const uploaded = await Effect.runPromise(Effect.either(mediaGateway.upload(local.right)));
    if (Either.isLeft(uploaded)) {
      setNotice("An attachment could not be uploaded. The area was not published.");
      setBusy(false);
      return;
    }
  }
  const pending = await Effect.runPromise(
    Effect.either(
      pendingPublicationOperation(
        publicationOperationStore,
        {
          sourceAreaId: area.id,
          content: releaseContent ?? area,
          visibility,
          ...(releaseNotes.trim() ? { releaseNotes: releaseNotes.trim() } : {}),
          attribution: attribution.trim() || null,
          license: license.trim() || null,
          forkedFromVersionId: area.forkedFromVersionId ?? null,
          reuseConfirmed,
        },
        createForkOperationId,
        createPublishShareToken,
      ),
    ),
  );
  if (Either.isLeft(pending)) {
    setPublicationConflict(pending.left.reason === "conflict");
    setNotice(
      pending.left.reason === "conflict"
        ? "This draft differs from a pending publication. Restore that draft to retry, or start a new publication attempt; the earlier attempt may already be published."
        : "The pending publication could not be saved. Restore local storage before retrying.",
    );
    setBusy(false);
    return;
  }
  const result = await Effect.runPromise(Effect.either(transport.publish(pending.right)));
  if (Either.isLeft(result)) {
    setPublicationConflict(
      result.left._tag === "PublishingApiFailure" &&
        result.left.reason === "http" &&
        result.left.code === "publication-operation-conflict",
    );
    setNotice(publicationFailureMessage(result.left));
  } else {
    setVersionId(result.right.version.id);
    setToken(result.right.shareToken ?? "");
    setShareToken(result.right.shareToken ?? null);
    setOwnsPublication(true);
    setPublishedVersionId(result.right.version.id);
    setPublishedVisibility(result.right.version.visibility ?? visibility);
    const cleared = await Effect.runPromise(
      Effect.either(publicationOperationStore.clear(area.id)),
    );
    await Effect.runPromise(
      Effect.either(scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope).clear(area.id)),
    );
    if (releaseContent) {
      await Effect.runPromise(
        Effect.either(
          writeReleaseBaseline(
            scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope),
            releaseContent,
          ),
        ),
      );
      setPreviousReleaseRecord({ areaId: area.id, value: releaseContent });
    }
    setPublicationConflict(false);
    setNotice(
      Either.isRight(cleared)
        ? "Deck published. Its study history remains private."
        : "Published, but the pending attempt could not be cleared. Retrying recovers this version.",
    );
  }
  setBusy(false);
}
