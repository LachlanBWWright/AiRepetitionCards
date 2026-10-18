import { useEffect, useMemo, useState } from "react";
import { Effect, Either, Fiber } from "effect";
import {
  diffKnowledgeAreas,
  inspectDeckQuality,
  previewRelease,
  publicationNeedsReuseConfirmation,
  readReleaseDraft,
  releaseDraftForArea,
  scopeReleaseDraftStore,
  verifyMediaAsset,
  withReleaseDifficulty,
  writeReleaseDraft,
  type DeckQualityFailure,
  type DeckQualityIssue,
  type KnowledgeAreaDiff,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { createBrowserReleaseDraftStore } from "@/lib/publishing/release-draft-store";
import { readDurableLibraryNotesPreference } from "@/lib/library-notes-store";
import { isDesktopRuntime } from "@/lib/desktop-api";
import type {
  KnowledgeAreaPublishingProps,
  UpstreamUpdateState,
} from "../KnowledgeAreaPublishingTypes";
import { readPreviousReleaseBaseline } from "./KnowledgeAreaPublishingBaseline";

type StateDependencies = {
  readonly area: KnowledgeArea | null | undefined;
  readonly lineageArea: KnowledgeArea | undefined;
  readonly initialUpstreamUpdate: UpstreamUpdateState | undefined;
  readonly initialRequest: KnowledgeAreaPublishingProps["initialRequest"];
  readonly initialPublication: KnowledgeAreaPublishingProps["initialPublication"];
  readonly initialPublishRecovery: KnowledgeAreaPublishingProps["initialPublishRecovery"];
  readonly initialForkRecovery: KnowledgeAreaPublishingProps["initialForkRecovery"];
  readonly releaseDraftScope: string;
  readonly retainDraftsOnDevice: boolean;
  readonly publicationOperationStore: NonNullable<
    KnowledgeAreaPublishingProps["publicationOperationStore"]
  >;
  readonly transport: NonNullable<KnowledgeAreaPublishingProps["transport"]>;
  readonly mediaStore: NonNullable<KnowledgeAreaPublishingProps["mediaStore"]>;
};

export function useKnowledgeAreaPublishingState({
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
}: StateDependencies) {
  const releaseDraftStore = useMemo(
    () =>
      createBrowserReleaseDraftStore(
        retainDraftsOnDevice || isDesktopRuntime(),
        () => isDesktopRuntime() || readDurableLibraryNotesPreference(releaseDraftScope),
      ),
    [retainDraftsOnDevice, releaseDraftScope],
  );
  const upstreamArea = lineageArea?.forkedFromVersionId
    ? lineageArea
    : area?.forkedFromVersionId
      ? area
      : null;
  const [upstreamRecord, setUpstreamRecord] = useState<{
    readonly sourceVersionId: string | null;
    readonly value: UpstreamUpdateState | null;
  }>({
    sourceVersionId: upstreamArea?.forkedFromVersionId ?? null,
    value: initialUpstreamUpdate ?? null,
  });
  const upstreamUpdate =
    upstreamRecord.sourceVersionId === (upstreamArea?.forkedFromVersionId ?? null)
      ? upstreamRecord.value
      : null;
  const setUpstreamUpdate = (value: UpstreamUpdateState) => {
    setUpstreamRecord({ sourceVersionId: upstreamArea?.forkedFromVersionId ?? null, value });
  };
  const [visibility, setVisibility] = useState<"unlisted" | "public">("unlisted");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [attribution, setAttribution] = useState(area?.attribution ?? "");
  const [license, setLicense] = useState(area?.licence ?? "");
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  const [difficulty, setDifficulty] = useState<"" | "beginner" | "intermediate" | "advanced">(
    area?.difficulty ?? "",
  );
  const [draftLoadedFor, setDraftLoadedFor] = useState<string | null>(null);
  const [previousReleaseRecord, setPreviousReleaseRecord] = useState<{
    readonly areaId: string | null;
    readonly value: KnowledgeArea | null;
  }>({ areaId: null, value: null });
  const needsReuseConfirmation = area ? publicationNeedsReuseConfirmation(area, license) : true;
  const [versionId, setVersionId] = useState(
    initialRequest?.versionId ?? initialPublication?.versionId ?? "",
  );
  const [token, setToken] = useState(initialRequest?.token ?? initialPublication?.token ?? "");
  const [shareToken, setShareToken] = useState(initialPublication?.token ?? null);
  const [publishedVersionId, setPublishedVersionId] = useState(
    initialPublication?.owner ? initialPublication.versionId : "",
  );
  const [publishedVisibility, setPublishedVisibility] = useState<"private" | "unlisted" | "public">(
    initialPublication?.visibility ?? "unlisted",
  );
  const [ownsPublication, setOwnsPublication] = useState(initialPublication?.owner ?? false);
  const [publication, setPublication] = useState<{
    readonly versionId: string;
    readonly token: string | null;
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null>(initialPublication ?? null);
  const [notice, setNotice] = useState<string | null>(
    initialForkRecovery === "local-save-failure"
      ? "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy."
      : initialPublishRecovery === "conflict"
        ? "This draft differs from a pending publication. Restore that draft to retry, or start a new publication attempt; the earlier attempt may already be published."
        : initialPublishRecovery === "pending"
          ? "The publication response was interrupted. Retry the saved attempt to recover its existing version."
          : null,
  );
  const [forkConflict, setForkConflict] = useState(false);
  const [publicationConflict, setPublicationConflict] = useState(
    initialPublishRecovery === "conflict",
  );
  const initialComparison =
    lineageArea?.forkedFromVersionId && initialPublication
      ? Effect.runSync(
          Effect.either(
            diffKnowledgeAreas({ baseline: lineageArea, candidate: initialPublication.document }),
          ),
        )
      : null;
  const [comparison, setComparison] = useState<KnowledgeAreaDiff | null>(
    initialComparison && Either.isRight(initialComparison) ? initialComparison.right : null,
  );
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const releaseContent = area ? withReleaseDifficulty(area, difficulty) : null;
  const previousRelease =
    initialPublication?.owner && initialPublication.document.id === area?.id
      ? initialPublication.document
      : previousReleaseRecord.areaId === area?.id
        ? previousReleaseRecord.value
        : null;
  const releasePreview =
    releaseContent && previousRelease
      ? Effect.runSync(Effect.either(previewRelease(previousRelease, releaseContent)))
      : null;
  const [qualityRecord, setQualityRecord] = useState<{
    readonly areaId: string | null;
    readonly result:
      | { readonly status: "ok"; readonly issues: readonly DeckQualityIssue[] }
      | { readonly status: "failed"; readonly failure: DeckQualityFailure }
      | null;
  }>({ areaId: null, result: null });
  const qualityResult = qualityRecord.areaId === area?.id ? qualityRecord.result : null;

  useEffect(() => {
    if (!area) return;
    let active = true;
    const references = [
      ...new Map(
        area.cards.flatMap((card) => card.media ?? []).map((item) => [item.id, item]),
      ).values(),
    ];
    const quality = Effect.all(
      references.map((reference) =>
        Effect.either(mediaStore.get(reference.id)).pipe(
          Effect.map((result) =>
            Either.isRight(result) && result.right !== null && verifyMediaAsset(result.right)
              ? reference.id
              : null,
          ),
        ),
      ),
    ).pipe(
      Effect.map((ids) => ids.filter((id) => id !== null)),
      Effect.flatMap((ids) => inspectDeckQuality(area, { availableMediaIds: ids })),
      Effect.either,
    );
    void Effect.runPromise(quality).then((result) => {
      if (active)
        setQualityRecord({
          areaId: area.id,
          result: Either.isRight(result)
            ? { status: "ok", issues: result.right }
            : { status: "failed", failure: result.left },
        });
    });
    return () => {
      active = false;
    };
  }, [area, mediaStore]);

  useEffect(() => {
    if (!area || initialPublication?.owner) return;
    const releaseStore = scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope);
    const fiber = Effect.runFork(
      readPreviousReleaseBaseline({
        area,
        releaseStore,
        transport,
        setPreviousReleaseRecord,
      }),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [
    area,
    initialPublication,
    publicationOperationStore,
    releaseDraftScope,
    releaseDraftStore,
    transport,
  ]);

  useEffect(() => {
    if (!area || draftLoadedFor === area.id) return;
    const fiber = Effect.runFork(
      readReleaseDraft(scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope), area.id).pipe(
        Effect.either,
        Effect.map((result) => {
          if (Either.isRight(result) && result.right) {
            setVisibility(result.right.visibility);
            setReleaseNotes(result.right.releaseNotes);
            setAttribution(result.right.attribution);
            setLicense(result.right.license);
            setReuseConfirmed(result.right.reuseConfirmed);
            setDifficulty(result.right.difficulty ?? "");
          }
          setDraftLoadedFor(area.id);
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [area, draftLoadedFor, publicationOperationStore, releaseDraftScope, releaseDraftStore]);

  useEffect(() => {
    if (!area || draftLoadedFor !== area.id) return;
    const draft = releaseDraftForArea(area, {
      visibility,
      releaseNotes,
      attribution,
      license,
      reuseConfirmed,
      ...(difficulty ? { difficulty } : {}),
    });
    const fiber = Effect.runFork(
      writeReleaseDraft(scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope), draft),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [
    area,
    attribution,
    difficulty,
    draftLoadedFor,
    license,
    releaseDraftScope,
    releaseDraftStore,
    releaseNotes,
    reuseConfirmed,
    visibility,
  ]);

  const [busy, setBusy] = useState(Boolean(initialRequest));
  const sharePath =
    publishedVersionId &&
    (publishedVisibility === "public" || (publishedVisibility === "unlisted" && shareToken))
      ? `/shared/${encodeURIComponent(publishedVersionId)}${publishedVisibility === "unlisted" && shareToken ? `?token=${encodeURIComponent(shareToken)}` : ""}`
      : null;
  const [shareOrigin, setShareOrigin] = useState<string | null>(null);
  useEffect(() => {
    const origin = isDesktopRuntime() ? process.env.RECALL_API_URL : window.location.origin;
    if (!origin) return;
    const fiber = Effect.runFork(
      Effect.try({
        try: () => new URL(origin),
        catch: () => ({ _tag: "InvalidShareOrigin" }) as const,
      }).pipe(
        Effect.either,
        Effect.map((parsed) => {
          setShareOrigin(
            Either.isRight(parsed) && ["http:", "https:"].includes(parsed.right.protocol)
              ? parsed.right.origin
              : null,
          );
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  return {
    area,
    initialRequest,
    lineageArea,
    initialPublication,
    releaseDraftStore,
    releaseDraftScope,
    publicationOperationStore,
    transport,
    mediaStore,
    upstreamArea,
    upstreamUpdate,
    setUpstreamUpdate,
    visibility,
    setVisibility,
    releaseNotes,
    setReleaseNotes,
    attribution,
    setAttribution,
    license,
    setLicense,
    reuseConfirmed,
    setReuseConfirmed,
    difficulty,
    setDifficulty,
    needsReuseConfirmation,
    versionId,
    setVersionId,
    token,
    setToken,
    shareToken,
    setShareToken,
    publishedVersionId,
    setPublishedVersionId,
    publishedVisibility,
    setPublishedVisibility,
    ownsPublication,
    setOwnsPublication,
    publication,
    setPublication,
    notice,
    setNotice,
    forkConflict,
    setForkConflict,
    publicationConflict,
    setPublicationConflict,
    comparison,
    setComparison,
    comparisonFailed,
    setComparisonFailed,
    releaseContent,
    setPreviousReleaseRecord,
    qualityResult,
    qualityIssues: qualityResult?.status === "ok" ? qualityResult.issues : [],
    hasQualityBlockers: Boolean(
      area &&
      (!qualityResult ||
        qualityResult.status === "failed" ||
        qualityResult.issues.some((issue) => issue.severity === "blocking")),
    ),
    releasePreview,
    busy,
    setBusy,
    sharePath,
    shareUrl: sharePath && shareOrigin ? `${shareOrigin}${sharePath}` : null,
    shareOrigin,
  };
}
