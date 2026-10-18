import { useCallback, useEffect } from "react";
import { Effect, Either, Fiber } from "effect";
import { diffKnowledgeAreas } from "@recall/application";
import type { KnowledgeAreaPublishingProps } from "../KnowledgeAreaPublishingTypes";
import type { useKnowledgeAreaPublishingState } from "./useKnowledgeAreaPublishingState";
import { runKnowledgeAreaPublishingForkWorkflow } from "./KnowledgeAreaPublishingForkWorkflow";
import { runKnowledgeAreaPublishingPublishWorkflow } from "./KnowledgeAreaPublishingPublishWorkflow";
import { toast } from "@recall/ui-web";

type PublishingState = ReturnType<typeof useKnowledgeAreaPublishingState>;
type ActionState = Pick<
  PublishingState,
  | "area"
  | "initialRequest"
  | "upstreamArea"
  | "publication"
  | "setPublication"
  | "setNotice"
  | "setBusy"
  | "setComparison"
  | "setComparisonFailed"
  | "setVersionId"
  | "setToken"
  | "setUpstreamUpdate"
  | "setPublicationConflict"
  | "setForkConflict"
  | "setShareToken"
  | "setOwnsPublication"
  | "setPublishedVersionId"
  | "setPublishedVisibility"
  | "setPreviousReleaseRecord"
  | "hasQualityBlockers"
  | "needsReuseConfirmation"
  | "license"
  | "reuseConfirmed"
  | "releaseContent"
  | "visibility"
  | "releaseNotes"
  | "attribution"
  | "publicationOperationStore"
  | "transport"
  | "releaseDraftStore"
  | "releaseDraftScope"
  | "mediaStore"
  | "versionId"
  | "token"
  | "shareUrl"
  | "publishedVersionId"
  | "ownsPublication"
>;
type ActionDependencies = {
  readonly state: ActionState;
  readonly onFork: KnowledgeAreaPublishingProps["onFork"];
  readonly forkOperationStore: NonNullable<KnowledgeAreaPublishingProps["forkOperationStore"]>;
  readonly createForkOperationId: () => string;
  readonly createPublishShareToken: () => string;
  readonly mediaGateway: NonNullable<KnowledgeAreaPublishingProps["mediaGateway"]>;
};

export function useKnowledgeAreaPublishingActions({
  state,
  onFork,
  forkOperationStore,
  createForkOperationId,
  createPublishShareToken,
  mediaGateway,
}: ActionDependencies) {
  const {
    area,
    upstreamArea,
    publication,
    setPublication,
    setNotice,
    setBusy,
    setComparison,
    setComparisonFailed,
    setVersionId,
    setToken,
    setUpstreamUpdate,
    setPublicationConflict,
    setForkConflict,
    setShareToken,
    setOwnsPublication,
    setPublishedVersionId,
    setPublishedVisibility,
    setPreviousReleaseRecord,
    hasQualityBlockers,
    needsReuseConfirmation,
    license,
    reuseConfirmed,
    releaseContent,
    visibility,
    releaseNotes,
    attribution,
    publicationOperationStore,
    transport,
    releaseDraftStore,
    releaseDraftScope,
    mediaStore,
    versionId,
    token,
    shareUrl,
    publishedVersionId,
    ownsPublication,
  } = state;

  const readPreview = useCallback(
    (request: { readonly versionId: string; readonly token?: string }) =>
      transport.read(request.versionId, request.token).pipe(
        Effect.either,
        Effect.map((result) => {
          setComparison(null);
          setComparisonFailed(false);
          if (Either.isLeft(result)) {
            setPublication(null);
            setNotice("Could not load this shared Deck. Check the link and access token.");
          } else {
            const received = result.right.version;
            if (upstreamArea) {
              const compared = compareAreas(upstreamArea, received.content);
              if (Either.isRight(compared)) setComparison(compared.right);
              else setComparisonFailed(true);
            }
            setVersionId(received.id);
            setPublication({
              versionId: received.id,
              token: request.token ?? null,
              document: received.content,
              attribution: received.attribution,
              license: received.license,
            });
            setNotice(
              upstreamArea
                ? "Review this version and its differences before adding a personal copy."
                : "Review the source and license before adding your own copy.",
            );
          }
          setBusy(false);
        }),
      ),
    [
      setBusy,
      setComparison,
      setComparisonFailed,
      setNotice,
      setPublication,
      setVersionId,
      transport,
      upstreamArea,
    ],
  );

  const initialVersionId = state.initialRequest?.versionId;
  const initialToken = state.initialRequest?.token;
  useEffect(() => {
    if (!initialVersionId) return;
    const fiber = Effect.runFork(
      readPreview({
        versionId: initialVersionId,
        ...(initialToken ? { token: initialToken } : {}),
      }),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [initialVersionId, initialToken, readPreview]);

  async function copyShareLink(): Promise<void> {
    if (!shareUrl) return;
    const copied = await Effect.runPromise(
      Effect.either(
        Effect.suspend(() => {
          if (!("clipboard" in navigator))
            return Effect.fail({ _tag: "ClipboardFailure" } as const);
          return Effect.tryPromise({
            try: () => navigator.clipboard.writeText(shareUrl),
            catch: () => ({ _tag: "ClipboardFailure" }) as const,
          });
        }),
      ),
    );
    if (Either.isRight(copied)) {
      setNotice(null);
      toast.success("Share link copied.");
    } else setNotice("Could not copy the link. Select and copy the link below.");
  }

  async function checkUpstreamUpdates(): Promise<void> {
    const sourceVersionId = upstreamArea?.forkedFromVersionId;
    if (!sourceVersionId) {
      setUpstreamUpdate({ status: "unavailable" });
      return;
    }
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(transport.checkUpdates({ versionId: sourceVersionId })),
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

  async function publish(): Promise<void> {
    await runKnowledgeAreaPublishingPublishWorkflow({
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
    });
  }

  async function manageShareToken(action: "rotate" | "revoke"): Promise<void> {
    if (!publishedVersionId || !ownsPublication) return;
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(transport.manageShareToken(publishedVersionId, action)),
    );
    if (Either.isLeft(result)) {
      setNotice(
        action === "rotate"
          ? "Could not rotate the share link."
          : "Could not revoke the share link.",
      );
    } else {
      const nextToken = result.right.token;
      setShareToken(nextToken);
      setToken(nextToken ?? "");
      setNotice(
        nextToken
          ? "A new share link is active. Previous links no longer work."
          : "The share link was revoked.",
      );
    }
    setBusy(false);
  }

  async function receive(): Promise<void> {
    if (!versionId.trim()) return;
    setBusy(true);
    setNotice(null);
    await Effect.runPromise(
      readPreview({
        versionId: versionId.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      }),
    );
  }

  const fork = () =>
    runKnowledgeAreaPublishingForkWorkflow({
      publication,
      forkOperationStore,
      createForkOperationId,
      transport,
      mediaGateway,
      onFork,
      setBusy,
      setNotice: (value) => {
        setNotice(value || null);
      },
      setForkConflict,
    });

  const clearForkAttempt = () => {
    if (!publication) return;
    Effect.runFork(
      forkOperationStore.clear(publication.versionId).pipe(
        Effect.match({
          onFailure: () => {
            setNotice(
              "The pending copy could not be cleared. Restore local storage before retrying.",
            );
          },
          onSuccess: () => {
            setForkConflict(false);
            setNotice(
              "The previous copy attempt was cleared. Add a personal copy to start a new operation.",
            );
          },
        }),
      ),
    );
  };

  const clearPublicationAttempt = () => {
    if (!area) return;
    Effect.runFork(
      publicationOperationStore.clear(area.id).pipe(
        Effect.match({
          onFailure: () => {
            setNotice("Could not clear the pending attempt.");
          },
          onSuccess: () => {
            setPublicationConflict(false);
            setNotice("A new publication attempt is ready. The earlier attempt may already exist.");
          },
        }),
      ),
    );
  };

  return {
    readPreview,
    copyShareLink,
    checkUpstreamUpdates,
    publish,
    manageShareToken,
    receive,
    fork,
    clearForkAttempt,
    clearPublicationAttempt,
  };
}

function compareAreas(
  baseline: NonNullable<PublishingState["upstreamArea"]>,
  candidate: NonNullable<PublishingState["area"]>,
) {
  return Effect.runSync(Effect.either(diffKnowledgeAreas({ baseline, candidate })));
}
