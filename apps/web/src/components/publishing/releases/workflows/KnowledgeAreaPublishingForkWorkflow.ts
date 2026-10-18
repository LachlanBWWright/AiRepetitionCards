import { Effect, Either } from "effect";
import {
  pendingPublicationForkOperation,
  type PublicationForkOperationStore,
  type PublishedMediaGateway,
  type PublishingApi,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { verifyMediaAsset } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";

type Publication = {
  readonly versionId: string;
  readonly token: string | null;
};

type ForkWorkflowDependencies = {
  readonly publication: Publication | null;
  readonly forkOperationStore: PublicationForkOperationStore;
  readonly createForkOperationId: () => string;
  readonly transport: PublishingApi;
  readonly mediaGateway: PublishedMediaGateway;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ) => boolean | Promise<boolean>;
  readonly setBusy: (busy: boolean) => void;
  readonly setNotice: (notice: string) => void;
  readonly setForkConflict: (conflict: boolean) => void;
};

export async function runKnowledgeAreaPublishingForkWorkflow({
  publication,
  forkOperationStore,
  createForkOperationId,
  transport,
  mediaGateway,
  onFork,
  setBusy,
  setNotice,
  setForkConflict,
}: ForkWorkflowDependencies): Promise<void> {
  if (!publication) return;
  setBusy(true);
  setNotice("");
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
      transport.fork(publication.versionId, operation.right, publication.token ?? undefined),
    ),
  );
  if (Either.isLeft(result)) {
    setNotice(
      result.left._tag === "PublishingApiFailure" &&
        result.left.reason === "http" &&
        result.left.status === 401
        ? "Sign in to add a personal copy, then return to this shared area."
        : "Could not create a personal copy of this Deck.",
    );
    setForkConflict(
      result.left._tag === "PublishingApiFailure" &&
        result.left.reason === "http" &&
        result.left.code === "fork-operation-conflict",
    );
  } else {
    const references = [
      ...new Map(
        result.right.document.cards
          .flatMap((card) => card.media ?? [])
          .map((item) => [item.id, item]),
      ).values(),
    ];
    const assets: StoredMediaAsset[] = [];
    for (const reference of references) {
      const downloaded = await Effect.runPromise(
        Effect.either(
          mediaGateway.read(publication.versionId, reference, publication.token ?? undefined),
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
        setNotice("A shared attachment could not be verified. The personal copy was not added.");
        setBusy(false);
        return;
      }
      assets.push(downloaded.right);
    }
    const copied = await onFork(
      result.right.document,
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
          ? "Your copy was added. Its pending operation could not be cleared; retrying will reopen the same copy."
          : "A personal copy was added. Its review schedule starts fresh."
        : "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy.",
    );
  }
  setBusy(false);
}
