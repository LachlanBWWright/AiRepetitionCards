import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
import {
  inspectDeckQuality,
  readReleaseBaseline,
  readReleaseDraft,
  releaseDraftForArea,
  scopeReleaseDraftStore,
  verifyMediaAsset,
  writeReleaseDraft,
  type DeckQualityFailure,
  type DeckQualityIssue,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { NativePublishingPanelProps } from "./NativePublishingPanel.types";

type LifecycleContext = {
  readonly area: KnowledgeArea | null;
  readonly mediaStore: NativePublishingPanelProps["mediaStore"];
  readonly clients: NativePublishingPanelProps["clients"];
  readonly deckSharing: NativePublishingPanelProps["deckSharing"];
  readonly initialPublication: NativePublishingPanelProps["initialPublication"];
  readonly publicationOperationStore: NativePublishingPanelProps["publicationOperationStore"];
  readonly releaseDraftStore: NonNullable<NativePublishingPanelProps["releaseDraftStore"]>;
  readonly releaseDraftScope: string;
  readonly visibility: "unlisted" | "public";
  readonly releaseNotes: string;
  readonly attribution: string;
  readonly license: string;
  readonly reuseConfirmed: boolean;
  readonly difficulty: "" | "beginner" | "intermediate" | "advanced";
  readonly setVisibility: (value: "unlisted" | "public") => void;
  readonly setReleaseNotes: (value: string) => void;
  readonly setAttribution: (value: string) => void;
  readonly setLicense: (value: string) => void;
  readonly setReuseConfirmed: (value: boolean) => void;
  readonly setDifficulty: (value: "" | "beginner" | "intermediate" | "advanced") => void;
};

function availableMediaForArea(
  area: KnowledgeArea,
  mediaStore: NativePublishingPanelProps["mediaStore"],
) {
  const references = [
    ...new Map(
      area.cards.flatMap((card) => card.media ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const availableMedia = Effect.all(
    references.map((reference) =>
      mediaStore
        ? Effect.either(mediaStore.get(reference.id)).pipe(
            Effect.map((result) =>
              Either.isRight(result) && result.right !== null && verifyMediaAsset(result.right)
                ? reference.id
                : null,
            ),
          )
        : Effect.succeed(null),
    ),
  ).pipe(
    Effect.map((ids) => ids.filter((id) => id !== null)),
    Effect.flatMap((ids) => inspectDeckQuality(area, { availableMediaIds: ids })),
    Effect.either,
  );
  return availableMedia;
}

export function useNativePublishingPanelLifecycle(context: LifecycleContext) {
  const {
    area,
    mediaStore,
    clients,
    deckSharing,
    initialPublication,
    publicationOperationStore,
    releaseDraftStore,
    releaseDraftScope,
    visibility,
    releaseNotes,
    attribution,
    license,
    reuseConfirmed,
    difficulty,
    setVisibility,
    setReleaseNotes,
    setAttribution,
    setLicense,
    setReuseConfirmed,
    setDifficulty,
  } = context;
  const [draftLoadedFor, setDraftLoadedFor] = useState<string | null>(null);
  const [previousReleaseRecord, setPreviousReleaseRecord] = useState<{
    readonly areaId: string | null;
    readonly value: KnowledgeArea | null;
  }>({ areaId: null, value: null });
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
    const availableMedia = availableMediaForArea(area, mediaStore);
    void Effect.runPromise(availableMedia).then((result) => {
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
  const qualityIssues = qualityResult?.status === "ok" ? qualityResult.issues : [];
  const hasQualityBlockers = Boolean(
    area &&
    (!qualityResult ||
      qualityResult.status === "failed" ||
      qualityIssues.some((issue) => issue.severity === "blocking")),
  );

  useEffect(() => {
    if (!area) return;
    const store = scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope);
    let active = true;
    const load = Effect.either(readReleaseBaseline(store, area.id)).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          if (active && Either.isRight(saved) && saved.right)
            setPreviousReleaseRecord({ areaId: area.id, value: saved.right });
        }),
      ),
      Effect.flatMap(() =>
        deckSharing ? Effect.either(deckSharing.read(area.id)) : Effect.succeed(null),
      ),
      Effect.flatMap((detail) => {
        if (!detail || Either.isLeft(detail) || !detail.right.canManage || !clients)
          return Effect.void;
        return Effect.either(clients.publishing.read(detail.right.deck.latestVersionId)).pipe(
          Effect.tap((version) =>
            Effect.sync(() => {
              if (active && Either.isRight(version) && version.right.version.content.id === area.id)
                setPreviousReleaseRecord({ areaId: area.id, value: version.right.version.content });
            }),
          ),
        );
      }),
    );
    void Effect.runPromise(load);
    return () => {
      active = false;
    };
  }, [
    area,
    clients,
    deckSharing,
    initialPublication,
    publicationOperationStore,
    releaseDraftStore,
    releaseDraftScope,
  ]);

  useEffect(() => {
    if (!area || draftLoadedFor === area.id) return;
    const draftStore = scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope);
    let active = true;
    void Effect.runPromise(Effect.either(readReleaseDraft(draftStore, area.id))).then((result) => {
      if (!active) return;
      if (Either.isRight(result) && result.right) {
        setVisibility(result.right.visibility);
        setReleaseNotes(result.right.releaseNotes);
        setAttribution(result.right.attribution);
        setLicense(result.right.license);
        setReuseConfirmed(result.right.reuseConfirmed);
        setDifficulty(result.right.difficulty ?? "");
      }
      setDraftLoadedFor(area.id);
    });
    return () => {
      active = false;
    };
  }, [
    area,
    draftLoadedFor,
    releaseDraftScope,
    releaseDraftStore,
    setAttribution,
    setDifficulty,
    setLicense,
    setReleaseNotes,
    setReuseConfirmed,
    setVisibility,
  ]);

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
    void Effect.runPromise(
      writeReleaseDraft(scopeReleaseDraftStore(releaseDraftStore, releaseDraftScope), draft),
    );
  }, [
    area,
    attribution,
    difficulty,
    draftLoadedFor,
    license,
    publicationOperationStore,
    releaseDraftStore,
    releaseDraftScope,
    releaseNotes,
    reuseConfirmed,
    visibility,
  ]);
  return {
    draftLoadedFor,
    previousReleaseRecord,
    setPreviousReleaseRecord,
    qualityResult,
    qualityIssues,
    hasQualityBlockers,
  };
}
