import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Effect, Either } from "effect";
import { designTokens } from "@recall/design-tokens";
import {
  diffKnowledgeAreas,
  publicationNeedsReuseConfirmation,
  withReleaseDifficulty,
  type KnowledgeAreaDiff,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { NativeDeckQualityPanel } from "../library/NativeDeckQualityPanel";
import { nativeReleaseDraftStore } from "../../storage/publishing/native-release-draft-store";

const palette = designTokens.color;

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
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === value, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setMode(value);
            }}
            className={`flex-1 min-h-[44px] items-center justify-center border-b border-recall-line ${mode === value ? "border-b-2 border-b-recall-darkGreen" : ""}`}
          >
            <Text className={"text-recall-darkGreen text-[12px] font-bold capitalize"}>
              {value === "publish" ? "Publish" : "Receive"}
            </Text>
          </Pressable>
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
            <Text accessibilityRole="alert" className="text-sm text-red-700">
              Deck quality could not be validated, so publishing is paused.
            </Text>
          )}
          <NativePublishingPanelReleasePreview
            previousRelease={previousRelease}
            releaseContent={releaseContent}
          />
          <Pressable
            accessibilityRole="button"
            disabled={
              busy ||
              !area ||
              !mediaStore ||
              hasQualityBlockers ||
              !license.trim() ||
              (needsReuseConfirmation && !reuseConfirmed)
            }
            onPress={() => void publish()}
            className={
              "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
            }
          >
            {busy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text className={"text-recall-surface font-bold text-[12px]"}>Publish area</Text>
            )}
          </Pressable>
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
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={startNewForkAttempt}
          className={"flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper"}
        >
          <Text>Start a new copy attempt</Text>
        </Pressable>
      ) : null}
      {publicationConflict && area ? (
        <Pressable
          className={
            "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
          }
          accessibilityRole="button"
          disabled={busy}
          onPress={startNewPublicationAttempt}
        >
          <Text className={"text-recall-surface font-bold text-[12px]"}>
            Start a new publication attempt
          </Text>
        </Pressable>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[12px] leading-[18px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
