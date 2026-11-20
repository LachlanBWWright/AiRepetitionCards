import { NativeButton } from "@recall/ui-native";

import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import {
  diffKnowledgeAreas,
  publicationNeedsReuseConfirmation,
  withReleaseDifficulty,
  type KnowledgeAreaDiff,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { NativeDeckQualityPanel } from "../library/NativeDeckQualityPanel";
import { nativeReleaseDraftStore } from "../../storage/publishing/native-release-draft-store";

import type {
  NativePublishingPanelProps,
  NativePublishingPanelUpstreamUpdateState as UpstreamUpdateState,
} from "./NativePublishingPanel.types";
import { NativePublishingPanelReceive } from "./NativePublishingPanel.Receive";
import { NativePublishingPanelPublishFields } from "./NativePublishingPanel.PublishFields";
import { NativePublishingPanelReleasePreview } from "./NativePublishingPanel.ReleasePreview";
import { NativePublishingPanelUpstreamSection } from "./NativePublishingPanel.UpstreamSection";
import { createNativePublishingPanelActions } from "./NativePublishingPanel.actions";
import { createNativePublishingPanelRecoveryActions } from "./NativePublishingPanel.recovery";
import { useNativePublishingPanelLifecycle } from "./NativePublishingPanel.lifecycle";

export function NativePublishingPanel(props: NativePublishingPanelProps) {
  const {
    area,
    lineageArea,
    mediaStore,
    onFork,
    clients,
    initialPublication,
    initialVersionId,
    initialUpstreamUpdate,
    initialToken,
    forkOperationStore,
    createForkOperationId,
    publicationOperationStore,
    createPublishShareToken,
    deckSharing,
    releaseDraftScope = "local",
    releaseDraftStore = nativeReleaseDraftStore,
    onUpdate,
  } = props;
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
  const [mode, setMode] = useState<"publish" | "receive">(
    initialPublication ? "receive" : "publish",
  );
  const [visibility, setVisibility] = useState<"unlisted" | "public">("unlisted");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [attribution, setAttribution] = useState(area?.attribution ?? "");
  const [license, setLicense] = useState(area?.licence ?? "");
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  const [difficulty, setDifficulty] = useState<"" | "beginner" | "intermediate" | "advanced">(
    area?.difficulty ?? "",
  );
  const needsReuseConfirmation = area ? publicationNeedsReuseConfirmation(area, license) : true;
  const [versionId, setVersionId] = useState(initialVersionId ?? "");
  const [token, setToken] = useState(initialToken ?? "");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [publication, setPublication] = useState<{
    readonly versionId: string;
    readonly token: string | null;
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null>(
    initialPublication
      ? { ...initialPublication, versionId: initialVersionId ?? "", token: null }
      : null,
  );
  const [comparison, setComparison] = useState<KnowledgeAreaDiff | null>(() => {
    if (!initialPublication || !lineageArea?.forkedFromVersionId) return null;
    const compared = Effect.runSync(
      Effect.either(
        diffKnowledgeAreas({
          baseline: lineageArea,
          candidate: initialPublication.document,
        }),
      ),
    );
    return Either.isRight(compared) ? compared.right : null;
  });
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forkConflict, setForkConflict] = useState(false);
  const [publicationConflict, setPublicationConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const releaseContent = area ? withReleaseDifficulty(area, difficulty) : null;
  const {
    previousReleaseRecord,
    setPreviousReleaseRecord,
    qualityResult,
    qualityIssues,
    hasQualityBlockers,
  } = useNativePublishingPanelLifecycle({
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
  });
  const previousRelease =
    previousReleaseRecord.areaId === area?.id ? previousReleaseRecord.value : null;
  const { checkUpstreamUpdates, publish, receive, fork } = createNativePublishingPanelActions({
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
  });
  const { startNewForkAttempt, startNewPublicationAttempt } =
    createNativePublishingPanelRecoveryActions({
      area,
      publication,
      forkOperationStore,
      publicationOperationStore,
      setNotice,
      setForkConflict,
      setPublicationConflict,
    });

  const receiveHandler = useRef<(versionId: string) => Promise<void>>(() =>
    Promise.resolve(undefined),
  );
  useEffect(() => {
    receiveHandler.current = receive;
  });
  useEffect(() => {
    if (!initialVersionId) return;
    const timer = setTimeout(() => {
      setMode("receive");
      setVersionId(initialVersionId);
      setToken(initialToken ?? "");
      void receiveHandler.current(initialVersionId);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [initialToken, initialVersionId]);

  if (!clients)
    return (
      <View
        className={"gap-[9px] py-[16px] border-t border-t-recall-line"}
        testID="native-publishing-panel"
      >
        <Text className={"text-recall-ink text-[17px] font-bold"}>Share files</Text>
        <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
          Import or export an area in Account. Shared area files exclude your review history and
          schedules.
        </Text>
      </View>
    );
  return (
    <View
      className={"gap-[9px] py-[16px] border-t border-t-recall-line"}
      testID="native-publishing-panel"
    >
      <View className={"flex-row gap-[8px]"}>
        {(["publish", "receive"] as const).map((value) => (
          <NativeButton
            label={value === "publish" ? "Publish" : "Receive"}
            variant="secondary"
            className="flex-1"
            key={value}
            accessibilityState={{ selected: mode === value, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setMode(value);
            }}
          />
        ))}
      </View>
      {mode === "publish" && (
        <>
          <NativePublishingPanelPublishFields
            area={area}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            releaseNotes={releaseNotes}
            onReleaseNotesChange={setReleaseNotes}
            attribution={attribution}
            onAttributionChange={setAttribution}
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            license={license}
            onLicenseChange={setLicense}
            needsReuseConfirmation={needsReuseConfirmation}
            reuseConfirmed={reuseConfirmed}
            onReuseConfirmedChange={setReuseConfirmed}
          />
          <NativeDeckQualityPanel issues={qualityIssues} />
          {!qualityResult && area && (
            <Text accessibilityRole="text" className="text-sm text-recall-muted">
              Checking cards and attached media before publishing…
            </Text>
          )}
          {qualityResult?.status === "failed" && (
            <Text accessibilityRole="alert" className="text-sm text-recall-dangerForeground">
              Deck quality could not be validated, so publishing is paused.
            </Text>
          )}
          <NativePublishingPanelReleasePreview
            previousRelease={previousRelease}
            releaseContent={releaseContent}
          />
          <NativeButton
            label={busy ? "Publishing…" : "Publish area"}
            accessibilityState={{ busy }}
            disabled={
              busy ||
              !area ||
              !mediaStore ||
              hasQualityBlockers ||
              !license.trim() ||
              (needsReuseConfirmation && !reuseConfirmed)
            }
            onPress={() => void publish()}
          />
          {versionId ? (
            <Text selectable className={"text-recall-muted text-[12px] leading-[18px]"}>
              Version: {versionId}
              {shareToken ? `\nShare token: ${shareToken}` : ""}
            </Text>
          ) : null}
        </>
      )}
      <NativePublishingPanelUpstreamSection
        upstreamArea={upstreamArea}
        upstreamUpdate={upstreamUpdate}
        busy={busy}
        onCheckUpdates={() => {
          void checkUpstreamUpdates();
        }}
        onReviewVersion={(availableVersionId) => {
          setToken("");
          setMode("receive");
          void receive(availableVersionId);
        }}
      />
      <NativePublishingPanelReceive
        mode={mode}
        versionId={versionId}
        token={token}
        busy={busy}
        publication={publication}
        comparison={comparison}
        comparisonFailed={comparisonFailed}
        area={area}
        clients={clients}
        createForkOperationId={createForkOperationId}
        onUpdate={onUpdate}
        onVersionIdChange={setVersionId}
        onTokenChange={setToken}
        onReceive={() => void receive()}
        onFork={() => void fork()}
      />
      {forkConflict && publication ? (
        <NativeButton
          label="Start a new copy attempt"
          variant="default"
          disabled={busy}
          onPress={startNewForkAttempt}
          className="flex-1"
        />
      ) : null}
      {publicationConflict && area ? (
        <NativeButton
          label="Start a new publication attempt"
          variant="default"
          disabled={busy}
          onPress={startNewPublicationAttempt}
        />
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[12px] leading-[18px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
