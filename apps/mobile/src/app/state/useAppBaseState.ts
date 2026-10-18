import { emptyActivityLibrary } from "@recall/domain";
import { useLibraryNotes } from "../../hooks/use-library-notes";
import { createNativeLibraryNotesStore } from "../../storage/workspace/native-library-notes";
import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";
import { Effect, Either } from "effect";
import { type WorkspaceSearchResult, mergeActivityLibraries } from "@recall/application";
import type { WorkspaceMediaClearResult } from "@recall/application";
import type { Workspace, ReviewEvent } from "@recall/domain";
import type { MediaStore, WorkspaceStore } from "@recall/local-store";
import { NativeAppTab as AppTab, type NativeAppTab } from "../../navigation";
import { useNativeDailyReminders } from "../../components/account/NativeDailyReminderSettingsPanel";
import { useNativeChatGPTAuth } from "../../hooks/use-native-chatgpt";
import { createNativeForkOperationStore } from "../../storage/publishing/native-fork-operation-store";
import { createNativePublicationOperationStore } from "../../storage/publishing/native-publication-operation-store";
import { createNativeWorkspaceLifetime } from "../../storage/workspace/native-workspace-lifetime";
export function useAppBaseState() {
  const chatGPT = useNativeChatGPTAuth();
  const [store, setStore] = useState<WorkspaceStore | null>(null);
  const [mediaStore, setMediaStore] = useState<MediaStore | null>(null);
  const clearLocalStores = useRef<Effect.Effect<WorkspaceMediaClearResult>>(
    Effect.succeed({ workspaceCleared: false, mediaCleared: false }),
  );
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const workspaceLifetime = useMemo(() => createNativeWorkspaceLifetime(), []);
  const [operationGeneration, setOperationGeneration] = useState(0);
  const pendingCleanupTargets = useRef<{
    readonly areaIds: readonly import("@recall/domain").AreaId[];
    readonly forkVersionIds: readonly string[];
  }>({ areaIds: [], forkVersionIds: [] });
  const syncConflictGeneration = useRef<number | null>(null);
  const syncConflictAuthGeneration = useRef<number | null>(null);
  const authSession = useRef({
    userId: null as string | null,
    token: null as string | null,
    generation: 0,
  });
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [selectedDeckVersion, setSelectedDeckVersion] = useState<{
    readonly versionId: string;
    readonly token?: string;
    readonly owner: string | null;
  } | null>(null);
  const visibleSelectedDeckVersion =
    selectedDeckVersion?.owner === accountUserId ? selectedDeckVersion : null;
  const [syncOwnershipIssue, setSyncOwnershipIssue] = useState<
    "account-mismatch" | "owner-adoption-required" | null
  >(null);
  const nativeForkOperationStore = useMemo(
    () =>
      createNativeForkOperationStore(
        () =>
          workspaceLifetime.generation() === operationGeneration && !workspaceLifetime.isBlocked(),
      ),
    [operationGeneration, workspaceLifetime],
  );
  const nativePublicationOperationStore = useMemo(
    () =>
      createNativePublicationOperationStore(
        () =>
          workspaceLifetime.generation() === operationGeneration && !workspaceLifetime.isBlocked(),
      ),
    [operationGeneration, workspaceLifetime],
  );
  const setWorkspace = useCallback(
    (update: SetStateAction<Workspace | null>) => {
      if (workspaceLifetime.isBlocked()) return;
      const next = typeof update === "function" ? update(workspaceRef.current) : update;
      workspaceRef.current = next;
      setWorkspaceState(next);
    },
    [workspaceLifetime],
  );
  const localWriteLane = useMemo(() => Effect.runSync(Effect.makeSemaphore(1)), []);
  const workspaceChangeLane = useMemo(() => Effect.runSync(Effect.makeSemaphore(1)), []);
  const [ready, setReady] = useState(false);
  const [cacheWritable, setCacheWritable] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reviewInProgress = useRef(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [activeTab, setActiveTabState] = useState<NativeAppTab>(AppTab.Today);
  const [subjectMode, setSubjectMode] =
    useState<import("../../navigation").SubjectMode>("overview");
  const [subjectSection, setSubjectSection] = useState<"cards" | "materials" | "progress">("cards");
  const [createSubjectRequest, setCreateSubjectRequest] = useState(0);
  const [reviewAll, setReviewAll] = useState(false);
  const [studySession, setStudySession] = useState<{
    readonly areaId: string;
    readonly events: readonly ReviewEvent[];
  } | null>(null);
  const [tutorActivity, setTutorActivity] = useState<"materials" | undefined>();
  const setActiveTab = useCallback(
    (tab: NativeAppTab) => {
      if (tab === AppTab.Tutor) {
        setSubjectMode(tutorActivity === "materials" ? "improve" : "tutor");
        setActiveTabState(AppTab.Library);
      } else setActiveTabState(tab);
    },
    [tutorActivity],
  );
  const openReminderToday = useCallback(() => {
    setActiveTab(AppTab.Today);
  }, [setActiveTab]);
  const dailyReminders = useNativeDailyReminders(openReminderToday);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [libraryTransfer, setLibraryTransfer] = useState<"export" | "backup" | null>(null);
  const [transferPending, setTransferPending] = useState(false);
  const [showImportChoices, setShowImportChoices] = useState(false);
  const [importingCards, setImportingCards] = useState(false);
  const notesWritable = !workspaceLifetime.isBlocked();
  const notesStore = useMemo(() => {
    const owner = workspace?.syncOwnerId ?? "local";
    return createNativeLibraryNotesStore(
      `${owner}:${String(operationGeneration)}`,
      () =>
        notesWritable &&
        !workspaceLifetime.isBlocked() &&
        workspaceLifetime.generation() === operationGeneration,
      mediaStore,
      owner,
    );
  }, [workspace?.syncOwnerId, workspaceLifetime, operationGeneration, mediaStore, notesWritable]);
  const libraryNotes = useLibraryNotes(notesStore);
  const deckTransferWorkspace = useMemo(() => {
    if (!workspace) return null;
    const merged = Effect.runSync(
      Effect.either(
        mergeActivityLibraries(
          workspace.activityLibrary ?? emptyActivityLibrary,
          libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
        ),
      ),
    );
    return Either.isRight(merged) ? { ...workspace, activityLibrary: merged.right } : null;
  }, [workspace, libraryNotes.notes.activityLibrary]);
  const [activityRestoreError, setActivityRestoreError] = useState<string | null>(null);
  const [deckUpdateInProgress, setDeckUpdateInProgress] = useState(false);
  const deckUpdateInProgressRef = useRef(false);
  const notesLoaded = libraryNotes.loaded;
  const updateActivityNotes = libraryNotes.update;
  const [learningActivityId, setLearningActivityId] = useState<string | undefined>();
  const [activeAreaId, setActiveAreaIdState] = useState<string | null>(null);
  const activeAreaIdRef = useRef<string | null>(null);
  const setActiveAreaId = useCallback(
    (areaId: string | null) => {
      setLearningActivityId(undefined);
      activeAreaIdRef.current = areaId;
      setActiveAreaIdState(areaId);
    },
    [setLearningActivityId, setActiveAreaIdState],
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<WorkspaceSearchResult | null>(null);
  const [syncConflictWorkspace, setSyncConflictWorkspace] = useState<Workspace | null>(null);
  const [nativeTutorSessionIds, setNativeTutorSessionIds] = useState<
    Readonly<Record<string, string | null>>
  >({});
  const [chatGPTSession, setChatGPTSession] = useState<{
    readonly scope: string;
    readonly areaId: string;
    readonly id: string | null;
  } | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  return {
    chatGPT,
    store,
    setStore,
    mediaStore,
    setMediaStore,
    clearLocalStores,
    workspace,
    setWorkspaceState,
    workspaceRef,
    workspaceLifetime,
    operationGeneration,
    setOperationGeneration,
    pendingCleanupTargets,
    syncConflictGeneration,
    syncConflictAuthGeneration,
    authSession,
    accountUserId,
    setAccountUserId,
    selectedDeckVersion,
    setSelectedDeckVersion,
    visibleSelectedDeckVersion,
    syncOwnershipIssue,
    setSyncOwnershipIssue,
    nativeForkOperationStore,
    nativePublicationOperationStore,
    setWorkspace,
    localWriteLane,
    workspaceChangeLane,
    ready,
    setReady,
    cacheWritable,
    setCacheWritable,
    showAnswer,
    setShowAnswer,
    message,
    setMessage,
    accountEmail,
    setAccountEmail,
    now,
    setNow,
    reviewInProgress,
    reviewPending,
    setReviewPending,
    subjectMode,
    setSubjectMode,
    subjectSection,
    setSubjectSection,
    createSubjectRequest,
    setCreateSubjectRequest,
    reviewAll,
    setReviewAll,
    activeTab,
    setActiveTab,
    openReminderToday,
    dailyReminders,
    studySession,
    setStudySession,
    tutorActivity,
    setTutorActivity,
    onlyFlagged,
    setOnlyFlagged,
    libraryTransfer,
    setLibraryTransfer,
    transferPending,
    setTransferPending,
    showImportChoices,
    setShowImportChoices,
    importingCards,
    setImportingCards,
    notesWritable,
    notesStore,
    libraryNotes,
    deckTransferWorkspace,
    activityRestoreError,
    setActivityRestoreError,
    deckUpdateInProgress,
    setDeckUpdateInProgress,
    deckUpdateInProgressRef,
    notesLoaded,
    updateActivityNotes,
    learningActivityId,
    setLearningActivityId,
    activeAreaId,
    setActiveAreaIdState,
    activeAreaIdRef,
    setActiveAreaId,
    searchOpen,
    setSearchOpen,
    searchTarget,
    setSearchTarget,
    syncConflictWorkspace,
    setSyncConflictWorkspace,
    nativeTutorSessionIds,
    setNativeTutorSessionIds,
    chatGPTSession,
    setChatGPTSession,
    mediaRevision,
    setMediaRevision,
  } as const;
}
export type AppBaseState = ReturnType<typeof useAppBaseState>;
