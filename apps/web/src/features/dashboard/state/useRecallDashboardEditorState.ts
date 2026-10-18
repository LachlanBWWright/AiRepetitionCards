import { useCallback, useRef, useState, type SetStateAction } from "react";
import { type AreaId } from "@recall/domain";
import {
  workspaceAuthoringBaseline,
  formatTagInput,
  type WorkspaceSearchResult,
} from "@recall/application";
import {
  DashboardView,
  type DashboardView as DashboardViewValue,
} from "@/features/dashboard/navigation/dashboard-navigation";
import {
  areaEditingBaseline,
  areaSaveFailureMessage,
  cardEditingBaseline,
  dashboardColors as colors,
  type PendingContentImport,
  type DeletionCommand,
  type DeletionRequest,
  staleAreaDraftMessage,
  staleCardDraftMessage,
} from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardBaseState } from "./useRecallDashboardBaseState";
export function useRecallDashboardEditorState(
  model: Pick<
    RecallDashboardBaseState,
    | "practiceId"
    | "initialAreaId"
    | "demo"
    | "setLocalActivityId"
    | "setLibraryDeckOpen"
    | "demoArea"
    | "workspace"
    | "demoCard"
    | "sharedRequest"
    | "initialImport"
    | "routeView"
    | "setLocalPracticeId"
    | "onViewChange"
  >,
) {
  const {
    practiceId,
    initialAreaId,
    demo,
    setLocalActivityId,
    setLibraryDeckOpen,
    demoArea,
    workspace,
    demoCard,
    sharedRequest,
    initialImport,
    routeView,
    setLocalPracticeId,
    onViewChange,
  } = model;
  const [selectedId, setSelectedIdState] = useState(
    practiceId ?? initialAreaId ?? demo?.selectedAreaId ?? demo?.editAreaId ?? "area-biology",
  );
  const setSelectedId = useCallback(
    (areaId: SetStateAction<string>) => {
      setLocalActivityId(undefined);
      setLibraryDeckOpen(true);
      setSelectedIdState(areaId);
    },
    [setLocalActivityId, setSelectedIdState, setLibraryDeckOpen],
  );
  const [showAnswer, setShowAnswer] = useState(demo?.showAnswer ?? false);
  const [addingArea, setAddingArea] = useState(Boolean(demo?.editAreaId));
  const [editingAreaId, setEditingAreaId] = useState<string | null>(demo?.editAreaId ?? null);
  const [areaColor, setAreaColor] = useState(demoArea?.color ?? colors[0]);
  const areaEditor = useRef<{
    generation: number;
    id: AreaId | null;
    baseline: string | undefined;
  }>({
    generation: 0,
    id: demoArea?.id ?? null,
    baseline: demoArea ? areaEditingBaseline(workspace, demoArea) : undefined,
  });
  const libraryMutationPending = useRef(false);
  const deckUpdatePendingRef = useRef(false);
  const [deckUpdatePending, setDeckUpdatePending] = useState(false);
  const [libraryMutation, setLibraryMutation] = useState<
    "area-save" | "area-delete" | "card-delete" | null
  >(null);
  const [areaEditorError, setAreaEditorError] = useState<string | null>(
    demo?.areaEditFailure === "stale-content"
      ? staleAreaDraftMessage
      : demo?.areaEditFailure === "storage"
        ? areaSaveFailureMessage
        : null,
  );
  const [areaDraftStale, setAreaDraftStale] = useState(demo?.areaEditFailure === "stale-content");
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(() => {
    const targetArea = workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0];
    const card = targetArea?.cards[0];
    if (!demo?.deletionFailure || !targetArea || (demo.deletionFailure === "card" && !card))
      return null;
    const command: DeletionCommand =
      demo.deletionFailure === "card" && card
        ? { kind: "delete-card", areaId: targetArea.id, cardId: card.id }
        : { kind: "delete-area", areaId: targetArea.id };
    return {
      command,
      baseline: workspaceAuthoringBaseline(workspace, command) ?? "",
      label: demo.deletionFailure === "card" ? (card?.front ?? "card") : targetArea.title,
      error:
        "Deletion could not be kept in the current tab. The content and review history remain available; reconnect and retry.",
      stale: false,
    };
  });
  const [addingCard, setAddingCard] = useState(Boolean(demo?.addCard || demoCard));
  const [editingCardId, setEditingCardId] = useState<string | null>(demoCard?.id ?? null);
  const initialEditorArea = demoCard
    ? workspace.areas.find((item) => item.cards.some((card) => card.id === demoCard.id))
    : undefined;
  const cardEditor = useRef({
    generation: 0,
    baseline:
      demoCard && initialEditorArea
        ? cardEditingBaseline(workspace, initialEditorArea, demoCard)
        : undefined,
    sourceCard: demoCard ?? null,
  });
  const cardEditorMounted = useRef(true);
  const cardSavePending = useRef(false);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardEditorError, setCardEditorError] = useState<string | null>(
    demo?.cardEditConflict ? staleCardDraftMessage : null,
  );
  const [cardDraftStale, setCardDraftStale] = useState(demo?.cardEditConflict ?? false);
  const [areaTitle, setAreaTitle] = useState(demoArea?.title ?? "");
  const [front, setFront] = useState(demoCard?.front ?? "");
  const [back, setBack] = useState(demoCard?.back ?? "");
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const [cardKind, setCardKind] = useState<"basic" | "cloze">(demoCard?.cloze ? "cloze" : "basic");
  const [clozeText, setClozeText] = useState(demoCard?.cloze?.text ?? "");
  const [clozeIndex, setClozeIndex] = useState(String(demoCard?.cloze?.deletionIndex ?? 1));
  const [cardObjectiveIds, setCardObjectiveIds] = useState<readonly string[]>(
    demoCard?.objectiveIds ?? [],
  );
  const [cardTags, setCardTags] = useState(formatTagInput(demoCard?.tags ?? []));
  const [removedMediaIds, setRemovedMediaIds] = useState<readonly string[]>([]);
  const [showAreaSettings, setShowAreaSettings] = useState(demo?.areaSettings ?? false);
  const [shareKnowledgeOpen, setShareKnowledgeOpen] = useState(Boolean(sharedRequest));
  const [sharingTab, setSharingTab] = useState(sharedRequest ? "publish" : "browse");
  const [reviewedRequest, setReviewedRequest] = useState<
    { readonly versionId: string; readonly token?: string } | undefined
  >();
  const [importExportOpen, setImportExportOpen] = useState(initialImport);
  const [reviewSettingsOpen, setReviewSettingsOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviews, setMediaPreviews] = useState<
    readonly { readonly mimeType: string; readonly url: string }[]
  >(() => demo?.mockMediaPreviews ?? []);
  const [pendingContentImport, setPendingContentImport] = useState<PendingContentImport | null>(
    null,
  );
  const [contentImportBusy, setContentImportBusy] = useState(false);
  const contentImportPending = useRef(false);
  const [deviceSettings, setDeviceSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const accountSettingsReturnFocus = useRef<HTMLButtonElement | null>(null);
  const accountMenuTrigger = useRef<HTMLButtonElement>(null);
  const [searchTarget, setSearchTarget] = useState<WorkspaceSearchResult | null>(null);
  const [localActiveView, setLocalActiveView] = useState<DashboardViewValue>(
    routeView ?? demo?.view ?? (sharedRequest ? DashboardView.Library : DashboardView.Today),
  );
  const activeView = routeView ?? localActiveView;
  const setActiveView = useCallback(
    (view: DashboardViewValue, targetAreaId?: string) => {
      setLocalPracticeId(undefined);
      if (targetAreaId) setSelectedIdState(targetAreaId);
      if (view === DashboardView.Library) setLibraryDeckOpen(Boolean(targetAreaId));
      if (onViewChange) onViewChange(view, targetAreaId);
      else setLocalActiveView(view);
    },
    [onViewChange, setLocalPracticeId, setLibraryDeckOpen],
  );
  return {
    selectedId,
    setSelectedIdState,
    setSelectedId,
    showAnswer,
    setShowAnswer,
    addingArea,
    setAddingArea,
    editingAreaId,
    setEditingAreaId,
    areaColor,
    setAreaColor,
    areaEditor,
    libraryMutationPending,
    deckUpdatePendingRef,
    deckUpdatePending,
    setDeckUpdatePending,
    libraryMutation,
    setLibraryMutation,
    areaEditorError,
    setAreaEditorError,
    areaDraftStale,
    setAreaDraftStale,
    deletionRequest,
    setDeletionRequest,
    addingCard,
    setAddingCard,
    editingCardId,
    setEditingCardId,
    initialEditorArea,
    cardEditor,
    cardEditorMounted,
    cardSavePending,
    cardSaving,
    setCardSaving,
    cardEditorError,
    setCardEditorError,
    cardDraftStale,
    setCardDraftStale,
    areaTitle,
    setAreaTitle,
    front,
    setFront,
    back,
    setBack,
    duplicateAcknowledgement,
    setDuplicateAcknowledgement,
    cardKind,
    setCardKind,
    clozeText,
    setClozeText,
    clozeIndex,
    setClozeIndex,
    cardObjectiveIds,
    setCardObjectiveIds,
    cardTags,
    setCardTags,
    removedMediaIds,
    setRemovedMediaIds,
    showAreaSettings,
    setShowAreaSettings,
    shareKnowledgeOpen,
    setShareKnowledgeOpen,
    sharingTab,
    setSharingTab,
    reviewedRequest,
    setReviewedRequest,
    importExportOpen,
    setImportExportOpen,
    reviewSettingsOpen,
    setReviewSettingsOpen,
    mediaFile,
    setMediaFile,
    mediaPreviews,
    setMediaPreviews,
    pendingContentImport,
    setPendingContentImport,
    contentImportBusy,
    setContentImportBusy,
    contentImportPending,
    deviceSettings,
    setDeviceSettings,
    searchOpen,
    setSearchOpen,
    accountPanelOpen,
    setAccountPanelOpen,
    accountSettingsOpen,
    setAccountSettingsOpen,
    accountSettingsReturnFocus,
    accountMenuTrigger,
    searchTarget,
    setSearchTarget,
    localActiveView,
    setLocalActiveView,
    activeView,
    setActiveView,
  } as const;
}
export type RecallDashboardEditorState = ReturnType<typeof useRecallDashboardEditorState>;
