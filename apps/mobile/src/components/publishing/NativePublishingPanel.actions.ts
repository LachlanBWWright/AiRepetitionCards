import { areaMediaReferences } from "@recall/application";
import { Effect, Either } from "effect";
import {
  diffKnowledgeAreas,
  pendingPublicationForkOperation,
  pendingPublicationOperation,
  publicationFailureMessage,
  verifyMediaAsset,
  writeReleaseBaseline,
  scopeReleaseDraftStore,
  type KnowledgeAreaDiff,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import type {
  NativePublishingPanelProps,
  NativePublishingPanelPublication,
  NativePublishingPanelUpstreamUpdateState,
} from "./NativePublishingPanel.types";

type StateSetter<T> = (value: T) => void;

export type NativePublishingPanelActionsContext = {
  readonly area: KnowledgeArea | null;
  readonly upstreamArea: KnowledgeArea | null;
  readonly clients: NativePublishingPanelProps["clients"];
  readonly mediaStore: NativePublishingPanelProps["mediaStore"];
  readonly onFork: NativePublishingPanelProps["onFork"];
  readonly forkOperationStore: NativePublishingPanelProps["forkOperationStore"];
  readonly createForkOperationId: NativePublishingPanelProps["createForkOperationId"];
  readonly publicationOperationStore: NativePublishingPanelProps["publicationOperationStore"];
  readonly createPublishShareToken: NativePublishingPanelProps["createPublishShareToken"];
  readonly releaseDraftStore: NonNullable<NativePublishingPanelProps["releaseDraftStore"]>;
  readonly releaseDraftScope: string;
  readonly releaseContent: KnowledgeArea | null;
  readonly hasQualityBlockers: boolean;
  readonly needsReuseConfirmation: boolean;
  readonly license: string;
  readonly reuseConfirmed: boolean;
  readonly visibility: "unlisted" | "public";
  readonly releaseNotes: string;
  readonly attribution: string;
  readonly versionId: string;
  readonly token: string;
  readonly publication: NativePublishingPanelPublication | null;
  readonly setUpstreamUpdate: StateSetter<NativePublishingPanelUpstreamUpdateState>;
  readonly setBusy: StateSetter<boolean>;
  readonly setNotice: StateSetter<string | null>;
  readonly setPublicationConflict: StateSetter<boolean>;
  readonly setVersionId: StateSetter<string>;
  readonly setToken: StateSetter<string>;
  readonly setShareToken: StateSetter<string | null>;
  readonly setPreviousReleaseRecord: StateSetter<{
    readonly areaId: string | null;
    readonly value: KnowledgeArea | null;
  }>;
  readonly setComparison: StateSetter<KnowledgeAreaDiff | null>;
  readonly setComparisonFailed: StateSetter<boolean>;
  readonly setPublication: StateSetter<NativePublishingPanelPublication | null>;
  readonly setForkConflict: StateSetter<boolean>;
};

export function createNativePublishingPanelActions(context: NativePublishingPanelActionsContext) {
  const {
    area,
    upstreamArea,
    clients,
    mediaStore,
    onFork,
    forkOperationStore,
    createForkOperationId,
    publicationOperationStore,
    createPublishShareToken,
    releaseDraftStore,
    releaseDraftScope,
    releaseContent,
    hasQualityBlockers,
    needsReuseConfirmation,
    license,
    reuseConfirmed,
    visibility,
    releaseNotes,
    attribution,
    versionId,
    token,
    publication,
    setUpstreamUpdate,
    setBusy,
    setNotice,
    setPublicationConflict,
    setVersionId,
    setToken,
    setShareToken,
    setPreviousReleaseRecord,
    setComparison,
    setComparisonFailed,
    setPublication,
    setForkConflict,
  } = context;

  async function checkUpstreamUpdates(): Promise<void> {
    const sourceVersionId = upstreamArea?.forkedFromVersionId;
    const api = clients?.publishing;
    if (!sourceVersionId || !api) {
      setUpstreamUpdate({ status: "unavailable" });
      return;
    }
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(api.checkUpdates({ versionId: sourceVersionId })),
    );
    if (Either.isLeft(result)) {
      const unavailable =
        result.left._tag === "PublishingApiFailure" &&
        result.left.reason === "http" &&
        [401, 403, 404].includes(result.left.status);
      setUpstreamUpdate({ status: unavailable ? "unavailable" : "failed" });
    } else {
      const update = result.right.latestPublicVersion;
      setUpstreamUpdate(
        update ? { status: "available", versionId: update.id } : { status: "no-public-update" },
      );
    }
    setBusy(false);
  }

  async function publish() {
    if (!area || !mediaStore) return;
    if (hasQualityBlockers) {
      setNotice("Fix the publishing blockers before publishing this area.");
      return;
    }
    if (!license.trim() || (needsReuseConfirmation && !reuseConfirmed)) {
      setNotice("Choose a license and confirm you have permission to share this content.");
      return;
    }
    const api = clients;
    if (!api) {
      setNotice("Sign in and configure the Recall API before publishing.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const references = areaMediaReferences(area);
    for (const reference of references) {
      const stored = await Effect.runPromise(Effect.either(mediaStore.get(reference.id)));
      if (Either.isLeft(stored) || !stored.right || !verifyMediaAsset(stored.right)) {
        setNotice(
          "An attachment is missing or failed integrity validation. The area was not published.",
        );
        setBusy(false);
        return;
      }
      const uploaded = await Effect.runPromise(Effect.either(api.media.upload(stored.right)));
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
            releaseNotes: releaseNotes.trim(),
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
    const result = await Effect.runPromise(Effect.either(api.publishing.publish(pending.right)));
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
          ? "Published."
          : "Published, but the pending attempt could not be cleared. Retrying recovers this version.",
      );
    }
    setBusy(false);
  }

  async function receive(exactVersionId?: string) {
    const api = clients;
    if (!api || !(exactVersionId ?? versionId.trim())) return;
    setBusy(true);
    setNotice(null);
    setComparison(null);
    setComparisonFailed(false);
    const result = await Effect.runPromise(
      Effect.either(
        api.publishing.read(exactVersionId ?? versionId.trim(), token.trim() || undefined),
      ),
    );
    if (Either.isLeft(result)) {
      setPublication(null);
      setNotice("Could not load this shared Deck.");
    } else {
      if (upstreamArea) {
        const compared = Effect.runSync(
          Effect.either(
            diffKnowledgeAreas({
              baseline: upstreamArea,
              candidate: result.right.version.content,
            }),
          ),
        );
        if (Either.isRight(compared)) setComparison(compared.right);
        else setComparisonFailed(true);
      }
      setPublication({
        versionId: result.right.version.id,
        token: token.trim() || null,
        document: result.right.version.content,
        attribution: result.right.version.attribution,
        license: result.right.version.license,
      });
      setVersionId(result.right.version.id);
      setNotice(
        upstreamArea
          ? "Review this version and its differences before adding a personal copy."
          : "Review the source and license before adding your own copy.",
      );
    }
    setBusy(false);
  }

  async function fork() {
    const api = clients;
    if (!api || !mediaStore || !publication) return;
    setBusy(true);
    setNotice(null);
    const operation = await Effect.runPromise(
      Effect.either(
        pendingPublicationForkOperation(
          forkOperationStore,
          publication.versionId,
          createForkOperationId,
        ),
      ),
    );
    if (Either.isLeft(operation)) {
      setNotice("The pending copy could not be saved. Restore local storage before retrying.");
      setBusy(false);
      return;
    }
    const result = await Effect.runPromise(
      Effect.either(
        api.publishing.fork(publication.versionId, operation.right, publication.token ?? undefined),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("Could not create a personal copy of this Deck.");
      setForkConflict(
        result.left._tag === "PublishingApiFailure" &&
          result.left.reason === "http" &&
          result.left.code === "fork-operation-conflict",
      );
      setBusy(false);
      return;
    }
    const document = result.right.document;
    const references = areaMediaReferences(document);
    const assets: StoredMediaAsset[] = [];
    for (const reference of references) {
      const downloaded = await Effect.runPromise(
        Effect.either(
          api.media.read(publication.versionId, reference, publication.token ?? undefined),
        ),
      );
      if (
        Either.isLeft(downloaded) ||
        !downloaded.right ||
        !verifyMediaAsset(downloaded.right) ||
        downloaded.right.reference.id !== reference.id ||
        downloaded.right.reference.mimeType !== reference.mimeType ||
        downloaded.right.reference.byteLength !== reference.byteLength
      ) {
        setNotice(
          "A shared attachment could not be verified. The personal copy was not added locally.",
        );
        setBusy(false);
        return;
      }
      assets.push(downloaded.right);
    }
    const copied = await onFork(
      document,
      result.right.attribution,
      result.right.license,
      result.right.forkedFromVersionId,
      result.right.contentHash,
      assets,
    );
    const cleared = copied
      ? await Effect.runPromise(Effect.either(forkOperationStore.clear(publication.versionId)))
      : null;
    setNotice(
      copied
        ? cleared && Either.isLeft(cleared)
          ? "Your copy was added. Retrying will reopen the same copy because its pending operation could not be cleared."
          : "Copy added with a fresh review schedule."
        : "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy.",
    );
    setBusy(false);
  }

  return { checkUpstreamUpdates, publish, receive, fork };
}
