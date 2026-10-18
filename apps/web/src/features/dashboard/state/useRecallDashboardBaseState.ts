import { readRef } from "@/lib/read-ref";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { Effect, Either } from "effect";
import { emptyActivityLibrary, type ReviewEvent } from "@recall/domain";
import { mergeActivityLibraries } from "@recall/application";
import { type Workspace } from "@/features/workspace/types";
import { useLibraryNotes } from "@/hooks/use-library-notes";
import {
  createBrowserLibraryNotesStore,
  readDurableLibraryNotesPreference,
  subscribeDurableLibraryNotesPreference,
} from "@/lib/library-notes-store";
import {
  localSnapshotStale,
  subscribeLocalSnapshot,
} from "@/features/workspace/local-snapshot-status";
import {
  localWritesBlocked,
  subscribeLocalWrites,
} from "@/features/workspace/local-write-coordinator";
import { createBrowserDeckSharingApi } from "@/lib/deck-sharing-api";
import { createBrowserActivityServices } from "@/lib/learning/activity-client";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { useRecallDashboardAccountState } from "@/features/dashboard/state/RecallDashboardAccountState";
import {
  type PendingReview,
  starterWorkspace as starter,
} from "@/features/dashboard/layout/RecallDashboardSupport";

function deferForPendingReview<A, E>(
  pendingReviewRef: { readonly current: PendingReview | null },
  operation: Effect.Effect<A, E>,
) {
  return Effect.suspend<A, E | { readonly _tag: "WorkspaceCommitPaused" }, never>(() =>
    readRef(pendingReviewRef) ? Effect.fail({ _tag: "WorkspaceCommitPaused" } as const) : operation,
  );
}
import type { RecallDashboardProps } from "../RecallDashboardProps";
export function useRecallDashboardBaseState({
  demo,
  sharedRequest,
  routeView,
  onViewChange,
  practiceId: routedPracticeId,
  onPracticeChange,
  initialAreaId,
  initialActivityId,
  onActivityChange,
  onOpenDeckPage,
  initialTutorActivity,
  initialImport = false,
  initialFlaggedOnly = false,
}: RecallDashboardProps) {
  const [subjectSection, setSubjectSection] = useState<"cards" | "materials" | "progress">("cards");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [localActivityId, setLocalActivityId] = useState<string | undefined>(initialActivityId);
  const [practiceAreaId, setPracticeAreaId] = useState<string | undefined>(routedPracticeId);
  const [localPracticeId, setLocalPracticeId] = useState<string | undefined>();
  const practiceId = routeView ? routedPracticeId : localPracticeId;
  const [sessionEvents, setSessionEvents] = useState<readonly ReviewEvent[]>([]);
  const [onlyFlagged, setOnlyFlagged] = useState(initialFlaggedOnly);
  const [libraryDeckOpen, setLibraryDeckOpen] = useState(
    Boolean(initialAreaId || initialActivityId || initialFlaggedOnly || demo?.selectedAreaId),
  );
  const [draftClose, setDraftClose] = useState<"card" | "area" | null>(null);
  const [libraryTools, setLibraryTools] = useState<"import" | "export" | "backup">("import");
  const [creationChoices, setCreationChoices] = useState(false);
  const [tutorActivity, setTutorActivity] = useState<"materials" | undefined>(initialTutorActivity);
  const saveAnother = useRef(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    readonly description: string;
    readonly onConfirm: () => unknown;
    readonly onCancel?: () => void;
  } | null>(null);
  const requestConfirmation = (
    description: string,
    onConfirm: () => unknown,
    onCancel?: () => void,
  ) => {
    setPendingConfirmation({ description, onConfirm, ...(onCancel ? { onCancel } : {}) });
  };
  const demoArea =
    demo?.areaDraft ?? demo?.workspace.areas.find((item) => item.id === demo.editAreaId);
  const demoCard =
    demo?.cardDraft ??
    demo?.workspace.areas.flatMap((item) => item.cards).find((item) => item.id === demo.editCardId);
  const [workspace, setWorkspaceState] = useState<Workspace>(
    demo?.workspace ?? { ...starter, reviewEvents: [] },
  );
  const deckSharingApi = useMemo(
    () => createBrowserDeckSharingApi(demo ? undefined : workspace.syncOwnerId),
    [demo, workspace.syncOwnerId],
  );
  const workspaceRef = useRef(workspace);
  const workspaceSaveLane = useRef<Promise<void>>(Promise.resolve());
  const reviewingRef = useRef(demo?.reviewSaveState === "saving");
  const pendingReviewRef = useRef<PendingReview | null>(null);
  const [reviewSaving, setReviewSaving] = useState(demo?.reviewSaveState === "saving");
  const [reviewSaveFailed, setReviewSaveFailed] = useState(demo?.reviewSaveState === "failure");
  const [missingDeletedReviewContent, setMissingDeletedReviewContent] = useState(
    demo?.missingReviewContent ?? false,
  );
  const [deletedReviewProvisionCapacity, setDeletedReviewProvisionCapacity] = useState(false);
  const setWorkspace = useCallback(
    (update: SetStateAction<Workspace>) => {
      if (
        localWritesBlocked() ||
        localSnapshotStale() ||
        demo?.localErasureBlocked ||
        demo?.localSnapshotStale
      )
        return;
      if (pendingReviewRef.current) {
        setImportNotice(
          "Workspace changes are paused until the pending review is saved. Retry saving the review before editing or importing content.",
        );
        return;
      }
      const next = typeof update === "function" ? update(workspaceRef.current) : update;
      workspaceRef.current = next;
      setWorkspaceState(next);
    },
    [demo?.localErasureBlocked, demo?.localSnapshotStale],
  );
  const enqueueWorkspaceSave = useCallback(<A>(operation: () => Promise<A>): Promise<A> => {
    const pending = workspaceSaveLane.current.then(operation);
    workspaceSaveLane.current = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }, []);
  const enqueueWorkspaceCommit = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.tryPromise({
      try: () =>
        enqueueWorkspaceSave(() =>
          Effect.runPromise(Effect.either(deferForPendingReview(pendingReviewRef, operation))),
        ),
      catch: () => ({ _tag: "WorkspaceCommitQueueFailure" }) as const,
    }).pipe(Effect.flatMap((result) => result));
  const [ready, setReady] = useState(false);
  const {
    accountStatus,
    checkAccount,
    setCloudWorkspaceLoaded,
    webAccountConfigured,
    workspaceUnlocked,
  } = useRecallDashboardAccountState(demo);
  const [cacheMayWrite, setCacheWritable] = useState(false);
  const [cacheHasProblem, setCacheBlocked] = useState(false);
  const localErased = useSyncExternalStore(subscribeLocalWrites, localWritesBlocked, () => false);
  const erased = demo?.localErasureBlocked ?? localErased;
  const localStale = useSyncExternalStore(subscribeLocalSnapshot, localSnapshotStale, () => false);
  const stale = demo?.localSnapshotStale ?? localStale;
  const cacheWritable = cacheMayWrite && !erased && !stale && !reviewSaveFailed && !reviewSaving;
  const cacheBlocked = cacheHasProblem || erased;
  const notesScope = demo ? "demo-library" : (workspace.syncOwnerId ?? "local");
  const canRetainActivityDrafts =
    !demo && !isDesktopRuntime() && accountStatus === "signed-in" && Boolean(workspace.syncOwnerId);
  const [draftRetentionBusy, setDraftRetentionBusy] = useState(false);
  const subscribeDraftRetention = useCallback(
    (listener: () => void) => subscribeDurableLibraryNotesPreference(notesScope, listener),
    [notesScope],
  );
  const durableActivityDrafts = useSyncExternalStore(
    subscribeDraftRetention,
    () => canRetainActivityDrafts && readDurableLibraryNotesPreference(notesScope),
    () => false,
  );
  const notesStore = useMemo(
    () =>
      createBrowserLibraryNotesStore(
        notesScope,
        !demo &&
          !isDesktopRuntime() &&
          accountStatus === "signed-in" &&
          Boolean(workspace.syncOwnerId),
        { durable: durableActivityDrafts },
      ),
    [notesScope, demo, accountStatus, workspace.syncOwnerId, durableActivityDrafts],
  );
  const activityServices = useMemo(
    () =>
      !demo && accountStatus === "signed-in"
        ? createBrowserActivityServices(workspace.syncOwnerId)
        : null,
    [demo, accountStatus, workspace.syncOwnerId],
  );
  const libraryNotes = useLibraryNotes(notesStore);
  const deckTransferWorkspace = useMemo(() => {
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
  const notesLoaded = libraryNotes.loaded;
  const updateActivityNotes = libraryNotes.update;
  const updateLibraryNotes = libraryNotes.update;
  return {
    subjectSection,
    setSubjectSection,
    demo,
    sharedRequest,
    routeView,
    onViewChange,
    routedPracticeId,
    onPracticeChange,
    initialAreaId,
    initialActivityId,
    onActivityChange,
    onOpenDeckPage,
    initialTutorActivity,
    initialImport,
    initialFlaggedOnly,
    localActivityId,
    setLocalActivityId,
    practiceAreaId,
    setPracticeAreaId,
    localPracticeId,
    setLocalPracticeId,
    practiceId,
    sessionEvents,
    setSessionEvents,
    onlyFlagged,
    setOnlyFlagged,
    libraryDeckOpen,
    setLibraryDeckOpen,
    draftClose,
    setDraftClose,
    libraryTools,
    setLibraryTools,
    creationChoices,
    setCreationChoices,
    tutorActivity,
    setTutorActivity,
    saveAnother,
    pendingConfirmation,
    setPendingConfirmation,
    requestConfirmation,
    demoArea,
    demoCard,
    workspace,
    setWorkspaceState,
    deckSharingApi,
    workspaceRef,
    workspaceSaveLane,
    reviewingRef,
    pendingReviewRef,
    reviewSaving,
    setReviewSaving,
    reviewSaveFailed,
    setReviewSaveFailed,
    missingDeletedReviewContent,
    setMissingDeletedReviewContent,
    deletedReviewProvisionCapacity,
    setDeletedReviewProvisionCapacity,
    setWorkspace,
    enqueueWorkspaceSave,
    enqueueWorkspaceCommit,
    ready,
    setReady,
    accountStatus,
    checkAccount,
    setCloudWorkspaceLoaded,
    webAccountConfigured,
    workspaceUnlocked,
    cacheMayWrite,
    setCacheWritable,
    cacheHasProblem,
    setCacheBlocked,
    localErased,
    erased,
    localStale,
    stale,
    cacheWritable,
    cacheBlocked,
    notesScope,
    canRetainActivityDrafts,
    draftRetentionBusy,
    setDraftRetentionBusy,
    subscribeDraftRetention,
    durableActivityDrafts,
    notesStore,
    activityServices,
    libraryNotes,
    deckTransferWorkspace,
    activityRestoreError,
    setActivityRestoreError,
    notesLoaded,
    updateActivityNotes,
    updateLibraryNotes,
    importNotice,
    setImportNotice,
  } as const;
}
export type RecallDashboardBaseState = ReturnType<typeof useRecallDashboardBaseState>;
