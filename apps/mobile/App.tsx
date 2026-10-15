import { emptyActivityLibrary } from "@recall/domain";
import { useLibraryNotes } from "./src/hooks/use-library-notes";
import {
  createNativeLibraryNotesStore,
  clearNativeLibraryNotes,
} from "./src/storage/native-library-notes";
import { withNativeOperationStoreLane } from "./src/storage/native-operation-store";
import { NativeButton } from "./src/components/ui/NativeButton";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Text, Alert, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { File, Paths } from "expo-file-system";
import { designTokens } from "@recall/design-tokens";
import {
  clearWorkspaceAndMedia,
  applyWorkspaceSyncChanges,
  applyWorkspaceAuthoringCommand,
  WorkspaceAuthoringCommandSchema,
  bindWorkspaceOwner,
  workspaceHasRemoteSyncMetadata,
  applyWorkspaceContentConflict,
  persistTutorCardApproval,
  loadWorkspace,
  recordReview,
  saveWorkspace,
  saveWorkspaceWithMedia,
  verifyMediaAsset,
  fromKnowledgeArea,
  toKnowledgeArea,
  workspaceDuplicateCandidates,
  type WorkspaceSearchResult,
  recommendLearningActivities,
  mergeActivityLibraries,
  applyDeckWorkspaceUpdate,
  retainPublishedActivityDefinitions,
  publicationContentHash,
  retainLibraryDraft,
  discardLibraryDraft,
  toggleCardFlag,
} from "@recall/application";
import type {
  AnkiImportProposal,
  WorkspaceMediaCommitFailure,
  WorkspaceMediaClearResult,
} from "@recall/application";
import { type ReviewRating } from "@recall/scheduler";
import type { Assessment, Workspace, ReviewEvent } from "@recall/domain";
import { createAreaId } from "@recall/domain";
import type { MediaStore, WorkspaceStore, StoredMediaAsset } from "@recall/local-store";
import {
  openSqliteMediaStore,
  openSqliteWorkspaceStore,
} from "./src/storage/sqlite-workspace-store";
import {
  confirmNativeMagicLink,
  sendNativeMagicLink,
  supabaseAuthClient,
} from "./src/storage/supabase-auth";
import { syncNativeWorkspace } from "./src/storage/native-workspace-sync";
import { makeNativeWorkspaceMediaGateway } from "./src/storage/native-workspace-media-gateway";
import { makeNativePublishingClients } from "./src/storage/native-publishing-api";
import { makeNativeDeckSharingApi } from "./src/storage/native-deck-sharing-api";
import {
  pickKnowledgeArea,
  pickWorkspaceBackup,
  shareKnowledgeArea,
  shareWorkspaceBackup,
} from "./src/storage/native-interchange";
import { createNativeActivityServices } from "./src/storage/native-activity-services";
import { NativeLearningActivitiesPanel } from "./src/components/NativeLearningActivitiesPanel";
import { NativeWorkspaceAuthoringPanel } from "./src/components/NativeWorkspaceAuthoringPanel";
import { NativeWorkspaceSearchPanel } from "./src/components/NativeWorkspaceSearchPanel";
import { NativeTodayScreen } from "./src/components/NativeTodayScreen";
import { NativeAppShell } from "./src/components/NativeAppShell";
import { NativeAppTab as AppTab, type NativeAppTab } from "./src/navigation";
import {
  NativeDailyReminderSettingsPanel,
  useNativeDailyReminders,
} from "./src/components/NativeDailyReminderSettingsPanel";
import { NativeBudgetSettingsPanel } from "./src/components/NativeBudgetSettingsPanel";
import { NativeAccountPanel } from "./src/components/NativeAccountPanel";
import { pickAnkiImport } from "./src/storage/native-anki-import";
import { pickNativeMedia } from "./src/storage/native-media-picker";
import { NativePublishingPanel } from "./src/components/NativePublishingPanel";
import { NativeDeckSharingPanel } from "./src/components/NativeDeckSharingPanel";
import { createNativeForkOperationStore } from "./src/storage/native-fork-operation-store";
import { createNativePublicationOperationStore } from "./src/storage/native-publication-operation-store";
import { clearNativePendingOperations } from "./src/storage/native-operation-store";
import { createNativeWorkspaceLifetime } from "./src/storage/native-workspace-lifetime";
import { encodePublicationShareToken } from "@recall/application";
import { identifyObjectiveGaps } from "@recall/ai-core";
import { clearNativeKnowledgeNotebooks } from "./src/storage/native-knowledge-notebook-store";
import { clearNativeDailyReminders } from "./src/storage/native-daily-reminders";
import { clearNativeLocalBudget } from "./src/storage/native-local-ai-budget";
import { NativeTutorPanel } from "./src/components/NativeTutorPanel";
import { type CardProposal } from "@recall/ai-core";
import { makeNativeTutorApi } from "./src/storage/native-tutor-api";
import {
  readNativeTutorSessionId,
  writeNativeTutorSessionId,
  clearNativeTutorSessionIds,
} from "./src/storage/native-tutor-session";
import { deleteNativeAccount, exportNativeAccountData } from "./src/storage/native-account-api";

const palette = designTokens.color;
const nativePublishingClients = makeNativePublishingClients(
  process.env.EXPO_PUBLIC_RECALL_API_URL ?? "",
  async () => {
    const authClient = supabaseAuthClient;
    if (!authClient) return null;
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: () => ({ _tag: "SessionReadError" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? (result.right.data.session?.access_token ?? null) : null;
  },
);

function createEmptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [],
  };
}

function dueNow(card: Assessment, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

export default function App() {
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
  function invalidateWorkspaceOperations() {
    setStudySession(null);
    setSyncOwnershipIssue(null);
    setSearchOpen(false);
    setSearchTarget(null);
    setOperationGeneration(workspaceLifetime.invalidate());
  }
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
  type NativeWorkspaceCommitFailure =
    | { readonly _tag: "NativeWorkspaceUnavailable"; readonly persisted?: boolean }
    | { readonly _tag: "NativeWorkspacePersistenceFailed"; readonly mediaRollback?: boolean };
  function commitWorkspaceChange<E>(
    transition: (current: Workspace) => Effect.Effect<Workspace, E>,
    expectedGeneration = workspaceLifetime.generation(),
    guard: {
      readonly persistFirst?: boolean;
      readonly retainBindingOnAuthChange?: boolean;
      readonly isCurrent?: () => boolean;
      readonly media?: readonly StoredMediaAsset[];
      readonly mediaForWorkspace?: (workspace: Workspace) => readonly StoredMediaAsset[];
      readonly restoreWrite?: boolean;
    } = {},
  ): Effect.Effect<Workspace, E | NativeWorkspaceCommitFailure> {
    return workspaceChangeLane.withPermits(1)(
      Effect.gen(function* () {
        const current = workspaceRef.current;
        if (
          workspaceLifetime.isBlocked() ||
          workspaceLifetime.generation() !== expectedGeneration ||
          guard.isCurrent?.() === false
        )
          return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
        if (!current) return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
        const next = yield* transition(current);
        if (
          workspaceLifetime.isBlocked() ||
          workspaceLifetime.generation() !== expectedGeneration ||
          guard.isCurrent?.() === false
        )
          return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
        const selectedMedia = guard.mediaForWorkspace?.(next) ?? guard.media;
        const media = selectedMedia?.length ? selectedMedia : undefined;
        if (!guard.persistFirst) setWorkspace(next);
        if (!store || (!cacheWritable && !guard.restoreWrite)) {
          return yield* Effect.fail({ _tag: "NativeWorkspacePersistenceFailed" } as const);
        } else {
          const persistence: Effect.Effect<
            void,
            | Effect.Effect.Error<ReturnType<typeof saveWorkspace>>
            | WorkspaceMediaCommitFailure
            | NativeWorkspaceCommitFailure
          > = media
            ? mediaStore
              ? saveWorkspaceWithMedia(store, mediaStore, next, media)
              : Effect.fail({ _tag: "NativeWorkspacePersistenceFailed" } as const)
            : saveWorkspace(store, next);
          yield* persistence.pipe(
            Effect.mapError((error) =>
              workspaceLifetime.generation() !== expectedGeneration || workspaceLifetime.isBlocked()
                ? ({ _tag: "NativeWorkspaceUnavailable" } as const)
                : ({
                    _tag: "NativeWorkspacePersistenceFailed",
                    mediaRollback:
                      error._tag === "WorkspaceMediaCommitFailure" &&
                      error.reason === "media-rollback",
                  } as const),
            ),
          );
        }
        if (workspaceLifetime.generation() !== expectedGeneration || workspaceLifetime.isBlocked())
          return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
        // Explicitly retained local commits remain authoritative after an auth change during saving.
        if (
          guard.persistFirst &&
          (guard.retainBindingOnAuthChange || guard.isCurrent?.() !== false)
        )
          setWorkspace(next);
        if (guard.isCurrent?.() === false)
          return yield* Effect.fail({
            _tag: "NativeWorkspaceUnavailable",
            persisted: guard.persistFirst === true && guard.retainBindingOnAuthChange === true,
          } as const);
        return next;
      }),
    );
  }
  const [showAnswer, setShowAnswer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reviewInProgress = useRef(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [activeTab, setActiveTab] = useState<NativeAppTab>(AppTab.Today);
  const openReminderToday = useCallback(() => setActiveTab(AppTab.Today), [setActiveTab]);
  const dailyReminders = useNativeDailyReminders(openReminderToday);
  const [studySession, setStudySession] = useState<{
    readonly areaId: string;
    readonly events: readonly ReviewEvent[];
  } | null>(null);
  const [tutorActivity, setTutorActivity] = useState<"materials" | undefined>();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [libraryTransfer, setLibraryTransfer] = useState<"export" | "backup" | null>(null);
  const [transferPending, setTransferPending] = useState(false);
  const [showImportChoices, setShowImportChoices] = useState(false);
  const [importingCards, setImportingCards] = useState(false);
  const notesWritable = !workspaceLifetime.isBlocked();
  const notesStore = useMemo(() => {
    const owner = workspace?.syncOwnerId ?? "local";
    return createNativeLibraryNotesStore(
      `${owner}:${operationGeneration}`,
      () =>
        notesWritable &&
        !workspaceLifetime.isBlocked() &&
        workspaceLifetime.generation() === operationGeneration,
      mediaStore,
      owner,
    );
  }, [workspace?.syncOwnerId, workspaceLifetime, operationGeneration, mediaStore, notesWritable]);
  const libraryNotes = useLibraryNotes(notesStore);
  const [activityRestoreError, setActivityRestoreError] = useState<string | null>(null);
  const [deckUpdateInProgress, setDeckUpdateInProgress] = useState(false);
  const deckUpdateInProgressRef = useRef(false);
  const notesLoaded = libraryNotes.loaded;
  const updateActivityNotes = libraryNotes.update;
  useEffect(() => {
    const restored = workspace?.activityLibrary;
    if (!restored || !notesLoaded) return;
    updateActivityNotes((notes) => {
      const merged = Effect.runSync(
        Effect.either(
          mergeActivityLibraries(restored, notes.activityLibrary ?? emptyActivityLibrary),
        ),
      );
      if (Either.isLeft(merged)) {
        setActivityRestoreError(merged.left.message);
        return notes;
      }
      setActivityRestoreError(null);
      return { ...notes, activityLibrary: merged.right };
    });
  }, [workspace?.activityLibrary, notesLoaded, updateActivityNotes]);

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
  function captureCleanupTargets() {
    const latest = workspaceRef.current;
    const areaIds = [
      ...new Set([
        ...pendingCleanupTargets.current.areaIds,
        ...(latest?.areas.map((area) => area.id) ?? []),
        ...(latest?.deletedAreas?.map((item) => item.areaId) ?? []),
        ...Object.keys(nativeTutorSessionIds).map(createAreaId),
      ]),
    ];
    const forkVersionIds = [
      ...new Set([
        ...pendingCleanupTargets.current.forkVersionIds,
        ...(latest?.areas.flatMap((area) =>
          area.forkedFromVersionId ? [area.forkedFromVersionId] : [],
        ) ?? []),
      ]),
    ];
    const targets = { areaIds, forkVersionIds };
    pendingCleanupTargets.current = targets;
    return targets;
  }
  function clearAuxiliaryNativeData(targets: ReturnType<typeof captureCleanupTargets>) {
    return Effect.gen(function* () {
      const pendingOperations = yield* Effect.either(
        clearNativePendingOperations(targets.areaIds, targets.forkVersionIds),
      );
      const tutorSessions = yield* Effect.either(clearNativeTutorSessionIds(targets.areaIds));
      const pendingOperationsCleared = Either.isRight(pendingOperations);
      const libraryDrafts = yield* Effect.either(clearNativeLibraryNotes);
      const notebooks = yield* Effect.either(clearNativeKnowledgeNotebooks(null));
      const reminders = yield* Effect.either(clearNativeDailyReminders);
      if (Either.isRight(reminders)) dailyReminders.markCleared();
      const budgets = yield* Effect.either(clearNativeLocalBudget);
      const tutorSessionsCleared =
        Either.isRight(tutorSessions) &&
        Either.isRight(notebooks) &&
        Either.isRight(libraryDrafts) &&
        Either.isRight(reminders) &&
        Either.isRight(budgets);
      if (pendingOperationsCleared && tutorSessionsCleared) {
        pendingCleanupTargets.current = { areaIds: [], forkVersionIds: [] };
        setNativeTutorSessionIds({});
      }
      return { pendingOperationsCleared, tutorSessionsCleared };
    });
  }
  const tutorApi = useMemo(() => {
    const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL ?? "";
    if (!apiUrl.trim() || !supabaseAuthClient) return null;
    return makeNativeTutorApi(
      apiUrl,
      async () => {
        const client = supabaseAuthClient;
        if (!client) return null;
        const result = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => client.auth.getSession(),
              catch: () => ({ _tag: "TutorSessionReadError" }) as const,
            }),
          ),
        );
        if (Either.isLeft(result)) return null;
        const session = result.right.data.session;
        const owner = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
        return Either.isRight(owner) && owner.right === accountUserId
          ? (session?.access_token ?? null)
          : null;
      },
      () => accountUserId,
    );
  }, [accountUserId]);

  const deckSharingApi = useMemo(() => {
    const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL ?? "";
    if (!apiUrl.trim()) return null;
    const owner = accountUserId;
    return makeNativeDeckSharingApi(
      apiUrl,
      async () => {
        const authClient = supabaseAuthClient;
        if (!owner || !authClient) return null;
        const result = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => authClient.auth.getSession(),
              catch: () => ({ _tag: "DeckSharingSessionReadFailure" }) as const,
            }),
          ),
        );
        if (Either.isLeft(result)) return null;
        const session = result.right.data.session;
        const user = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
        return Either.isRight(user) && user.right === owner
          ? (session?.access_token ?? null)
          : null;
      },
      owner ?? undefined,
    );
  }, [accountUserId]);

  const activityServices = useMemo(() => {
    const url =
      process.env.EXPO_PUBLIC_RECALL_ACTIVITY_API_URL ??
      process.env.EXPO_PUBLIC_RECALL_API_URL ??
      "";
    if (!url.trim() || !supabaseAuthClient || !accountUserId) return null;
    const owner = accountUserId;
    return createNativeActivityServices(
      url,
      async () => {
        const client = supabaseAuthClient;
        if (!client) return null;
        const result = await client.auth.getSession();
        return result.data.session?.user.id === owner ? result.data.session.access_token : null;
      },
      owner,
    );
  }, [accountUserId]);

  useEffect(() => {
    const client = supabaseAuthClient;
    if (!client) return;
    let active = true;
    const loadSession = Effect.tryPromise({
      try: () => client.auth.getSession(),
      catch: () => ({ _tag: "SessionReadError" }) as const,
    });
    const updateSession = (
      session: {
        readonly user: { readonly id: string; readonly email?: string };
        readonly access_token: string;
      } | null,
    ) => {
      if (!active) return;
      const decoded = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
      const userId = Either.isRight(decoded) ? decoded.right.toLowerCase() : null;
      const token = userId ? (session?.access_token ?? null) : null;
      if (authSession.current.userId !== userId || authSession.current.token !== token) {
        authSession.current = { userId, token, generation: authSession.current.generation + 1 };
        syncConflictGeneration.current = null;
        syncConflictAuthGeneration.current = null;
        setSyncConflictWorkspace(null);
        setSyncOwnershipIssue(null);
      }
      setAccountUserId(userId);
      setAccountEmail(userId ? (session?.user.email ?? "Signed-in account") : null);
    };
    const initialGeneration = authSession.current.generation;
    void Effect.runPromise(Effect.either(loadSession)).then((result) => {
      if (active && Either.isRight(result) && initialGeneration === authSession.current.generation)
        updateSession(result.right.data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => updateSession(session));
    const handleUrl = (url: string | null) => {
      if (url) void Effect.runPromise(Effect.either(confirmNativeMagicLink(url)));
    };
    const initialUrl = Effect.tryPromise({
      try: () => Linking.getInitialURL(),
      catch: () => ({ _tag: "InitialLinkReadError" }) as const,
    });
    void Effect.runPromise(Effect.either(initialUrl)).then((result) => {
      if (Either.isRight(result)) handleUrl(result.right);
    });
    const subscription = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => {
      active = false;
      subscription.remove();
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void Effect.runPromise(Effect.either(openSqliteWorkspaceStore())).then(async (opened) => {
      if (!mounted) return;
      if (Either.isLeft(opened)) {
        setWorkspace(createEmptyWorkspace());
        setMessage(
          "Couldn’t open this app’s local storage. Study changes won’t be saved if you continue.",
        );
        setReady(true);
        return;
      }

      const rawStore = opened.right;
      const openedMedia = await Effect.runPromise(Effect.either(openSqliteMediaStore()));
      if (!mounted) return;
      const rawMedia = Either.isRight(openedMedia) ? openedMedia.right : null;
      const mayWrite = (generation: number) =>
        mounted && !workspaceLifetime.isBlocked() && generation === workspaceLifetime.generation();
      function coordinateMutation<A, E>(operation: Effect.Effect<A, E>, onBlocked: () => E) {
        const generation = workspaceLifetime.generation();
        return localWriteLane.withPermits(1)(
          Effect.suspend(() => (mayWrite(generation) ? operation : Effect.fail(onBlocked()))),
        );
      }
      const localStore: WorkspaceStore = {
        read: rawStore.read,
        write: (serialized) =>
          coordinateMutation(
            rawStore.write(serialized),
            () => ({ _tag: "LocalStoreFailure", operation: "write" }) as const,
          ),
        clear: localWriteLane.withPermits(1)(rawStore.clear),
        ...(rawMedia
          ? {
              coordinateMediaCommit: (
                commit: Parameters<NonNullable<WorkspaceStore["coordinateMediaCommit"]>>[0],
              ) => {
                const generation = workspaceLifetime.generation();
                const guardedWorkspace: WorkspaceStore = {
                  ...rawStore,
                  write: (serialized) =>
                    Effect.suspend(() =>
                      mayWrite(generation)
                        ? rawStore.write(serialized)
                        : Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const),
                    ),
                };
                const guardedMedia: MediaStore = {
                  ...rawMedia,
                  put: (asset) =>
                    Effect.suspend(() =>
                      mayWrite(generation)
                        ? rawMedia.put(asset)
                        : Effect.fail({ _tag: "MediaStoreFailure", operation: "write" } as const),
                    ),
                };
                return coordinateMutation(
                  commit(guardedWorkspace, guardedMedia),
                  () =>
                    ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
                );
              },
            }
          : {}),
      };
      if (rawMedia) {
        setMediaStore({
          ...rawMedia,
          put: (asset) =>
            coordinateMutation(
              rawMedia.put(asset),
              () => ({ _tag: "MediaStoreFailure", operation: "write" }) as const,
            ),
          delete: (id) =>
            coordinateMutation(
              rawMedia.delete(id),
              () => ({ _tag: "MediaStoreFailure", operation: "delete" }) as const,
            ),
        });
        // Cleanup bypasses the paused-write fence while holding the same lane as paired commits.
        clearLocalStores.current = localWriteLane.withPermits(1)(
          clearWorkspaceAndMedia(rawStore, rawMedia),
        );
      }
      const loaded = await Effect.runPromise(Effect.either(loadWorkspace(localStore)));
      if (!mounted) return;
      setStore(localStore);
      if (Either.isLeft(loaded)) {
        setWorkspace(createEmptyWorkspace());
        setMessage("Saved cards could not be read. Existing data was left untouched.");
        setReady(true);
        return;
      }

      if (loaded.right._tag === "Loaded") {
        setWorkspace(loaded.right.workspace);
        setCacheWritable(true);
      } else if (loaded.right._tag === "Empty") {
        const emptyWorkspace = createEmptyWorkspace();
        const saved = await Effect.runPromise(
          Effect.either(saveWorkspace(localStore, emptyWorkspace)),
        );
        setWorkspace(emptyWorkspace);
        setCacheWritable(Either.isRight(saved));
        if (Either.isLeft(saved))
          setMessage("Local storage is read-only. Changes won’t be saved after you leave.");
      } else {
        setWorkspace(createEmptyWorkspace());
        setMessage(
          "Saved cards use an invalid or newer format. The original data was left untouched.",
        );
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [localWriteLane, setWorkspace, workspaceLifetime]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const activeArea =
    workspace?.areas.find((area) => area.id === activeAreaId) ?? workspace?.areas[0];
  const activeTutorAreaId = activeArea?.id ?? null;
  const nativeTutorSessionId = activeArea ? (nativeTutorSessionIds[activeArea.id] ?? null) : null;
  useEffect(() => {
    if (!activeTutorAreaId) return;
    let mounted = true;
    const generation = workspaceLifetime.generation();
    void Effect.runPromise(Effect.either(readNativeTutorSessionId(activeTutorAreaId))).then(
      (result) => {
        if (
          !mounted ||
          Either.isLeft(result) ||
          workspaceLifetime.isBlocked() ||
          workspaceLifetime.generation() !== generation
        )
          return;
        setNativeTutorSessionIds((current) => ({
          ...current,
          [activeTutorAreaId]: result.right,
        }));
      },
    );
    return () => {
      mounted = false;
    };
  }, [activeTutorAreaId, operationGeneration, workspaceLifetime]);
  const activeKnowledgeArea = activeArea
    ? Effect.runSync(Effect.either(toKnowledgeArea(activeArea, false, true)))
    : null;
  const activePublishingArea = activeArea
    ? Effect.runSync(
        Effect.either(
          toKnowledgeArea(activeArea, true, true).pipe(
            Effect.map((document) => ({
              ...document,
              activities: (libraryNotes.notes.activityLibrary?.activities ?? []).filter(
                (activity) => activity.areaId === activeArea.id && !activity.archived,
              ),
            })),
          ),
        ),
      )
    : null;
  const dueCards = useMemo(
    () => activeArea?.cards.filter((card) => dueNow(card, now)) ?? [],
    [activeArea, now],
  );
  const card = dueCards[0];
  const [mediaUris, setMediaUris] = useState<Readonly<Record<string, string>>>({});
  const [mediaRevision, setMediaRevision] = useState(0);

  useEffect(() => {
    if (!mediaStore || !card?.media?.length) return;
    let active = true;
    const cacheAssets = Effect.forEach(card.media, (reference) =>
      Effect.gen(function* () {
        const asset = yield* mediaStore.get(reference.id);
        if (!asset || !verifyMediaAsset(asset)) return null;
        const extension: Record<typeof reference.mimeType, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "image/webp": "webp",
          "audio/mpeg": "mp3",
          "audio/ogg": "ogg",
          "audio/wav": "wav",
        };
        const file = yield* Effect.try({
          try: () =>
            new File(Paths.cache, `recall-${reference.id}.${extension[reference.mimeType]}`),
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        yield* Effect.try({
          try: () => file.write(asset.bytes),
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        return { id: reference.id, uri: file.uri };
      }),
    );
    void Effect.runPromise(Effect.either(cacheAssets)).then((result) => {
      if (!active || Either.isLeft(result)) return;
      const nextUris = result.right.reduce<Record<string, string>>((uris, asset) => {
        if (asset) uris[asset.id] = asset.uri;
        return uris;
      }, {});
      setMediaUris(nextUris);
    });
    return () => {
      active = false;
    };
  }, [card?.id, card?.media, mediaStore, mediaRevision]);

  async function review(rating: ReviewRating) {
    if (reviewInProgress.current || !workspace || !activeArea || !card) return;
    reviewInProgress.current = true;
    setReviewPending(true);
    setShowAnswer(false);
    const areaId = activeArea.id;
    const cardId = card.id;
    const ratedAt = new Date().toISOString();
    let sessionEvent: ReviewEvent | null = null;
    const program = commitWorkspaceChange((current) =>
      Effect.gen(function* () {
        const eventId = yield* Effect.try({
          try: () => Crypto.randomUUID(),
          catch: () => ({ _tag: "NativeReviewIdentityUnavailable" }) as const,
        });
        const transition = yield* recordReview({
          workspace: current,
          areaId,
          cardId,
          rating,
          eventId,
          ratedAt,
        });
        sessionEvent = transition.event;
        return transition.workspace;
      }),
    ).pipe(
      Effect.match({
        onFailure: (failure) => {
          if (failure._tag === "NativeWorkspacePersistenceFailed") {
            setCacheWritable(false);
            const recorded = workspaceRef.current?.reviewEvents?.find(
              (event) => event.id === sessionEvent?.id,
            );
            if (recorded)
              setStudySession((current) => ({
                areaId,
                events: [...(current?.areaId === areaId ? current.events : []), recorded],
              }));
          }
          setMessage(
            failure._tag === "NativeWorkspacePersistenceFailed"
              ? "Your review is recorded in this session, but local storage could not save it."
              : "That review could not be recorded. Your existing history has been preserved.",
          );
        },
        onSuccess: () => {
          if (sessionEvent) {
            const event = sessionEvent;
            setStudySession((current) => ({
              areaId,
              events: [...(current?.areaId === areaId ? current.events : []), event],
            }));
          }
          setNow(Date.now());
        },
      }),
      Effect.ensuring(
        Effect.sync(() => {
          reviewInProgress.current = false;
          setReviewPending(false);
        }),
      ),
    );
    await Effect.runPromise(program);
  }

  function resetLocalWorkspace() {
    if (!store || !mediaStore) return;
    const targets = captureCleanupTargets();
    invalidateWorkspaceOperations();
    workspaceLifetime.pauseWrites();
    syncConflictGeneration.current = null;
    setSyncConflictWorkspace(null);
    void Effect.runPromise(
      Effect.gen(function* () {
        const workspaceAndMedia = yield* withNativeOperationStoreLane(clearLocalStores.current);
        const auxiliary = yield* clearAuxiliaryNativeData(targets);
        return { ...workspaceAndMedia, ...auxiliary };
      }),
    ).then((result) => {
      if (
        !result.workspaceCleared ||
        !result.mediaCleared ||
        !result.pendingOperationsCleared ||
        !result.tutorSessionsCleared
      ) {
        setMessage(
          "Local cleanup is incomplete. Writes remain paused; reset this device again to retry.",
        );
        return;
      }
      workspaceLifetime.resumeWrites();
      const emptyWorkspace = createEmptyWorkspace();
      setWorkspace(emptyWorkspace);
      void Effect.runPromise(Effect.either(saveWorkspace(store, emptyWorkspace))).then((saved) => {
        setActiveAreaId(emptyWorkspace.areas[0]?.id ?? null);
        setCacheWritable(Either.isRight(saved));
        setShowAnswer(false);
        setMessage(
          Either.isRight(saved) ? "Your library is empty." : "Local storage is unavailable.",
        );
      });
    });
  }

  async function importAnkiDeck(): Promise<void> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (!workspace || !mediaStore) {
      setMessage("Local library storage is not ready yet.");
      return;
    }
    const areaColors = [palette.green, palette.coral, palette.violet, palette.amber];
    const picked = await Effect.runPromise(
      Effect.either(
        pickAnkiImport({
          color: areaColors[workspace.areas.length % areaColors.length] ?? palette.green,
          createId: () => Crypto.randomUUID(),
        }),
      ),
    );
    if (Either.isLeft(picked)) {
      setMessage("Anki import failed. Choose a supported .apkg package below 50 MB.");
      return;
    }
    if (!picked.right) return;
    if (
      workspaceLifetime.generation() !== generation ||
      authSession.current.generation !== authGeneration ||
      workspaceLifetime.isBlocked()
    ) {
      setMessage("Import discarded because this workspace or account changed.");
      return;
    }
    const proposal = picked.right;
    Alert.alert(
      "Review Anki import",
      `${proposal.area.title}\n${proposal.area.cards.length} cards · ${proposal.reviewEvents.length} reviews${proposal.excludedReviewCount > 0 ? ` · ${proposal.excludedReviewCount} cram/reschedule entries excluded` : ""}\n\nImported review history is retained. New cards start with a fresh Recall schedule.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Import",
          onPress: () => void acceptAnkiImport(proposal, generation, authGeneration),
        },
      ],
    );
  }

  async function acceptAnkiImport(
    proposal: AnkiImportProposal,
    generation: number,
    authGeneration: number,
  ): Promise<void> {
    if (!mediaStore) return;
    const accepted = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.succeed({
              ...current,
              areas: [...current.areas, proposal.area],
              reviews: current.reviews + proposal.reviewEvents.length,
              reviewEvents: [...(current.reviewEvents ?? []), ...proposal.reviewEvents],
            }),
          generation,
          {
            persistFirst: true,
            media: proposal.media,
            isCurrent: () => authSession.current.generation === authGeneration,
          },
        ),
      ),
    );
    if (Either.isLeft(accepted)) {
      if (accepted.left._tag === "NativeWorkspacePersistenceFailed") {
        setCacheWritable(false);
        setMessage(
          accepted.left.mediaRollback
            ? "The import was not added. Local storage failed and some temporary attachments could not be removed."
            : "The import was not added because its workspace or attachments could not be saved.",
        );
      } else setMessage("Import discarded because this workspace or account changed.");
      return;
    }
    setActiveAreaId(proposal.area.id);
    setShowAnswer(false);
    setMessage(
      `${proposal.area.cards.length} Anki cards and ${proposal.reviewEvents.length} reviews imported.`,
    );
  }

  async function syncCloudWorkspace(adoptLegacyOwner = false): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (workspaceLifetime.isBlocked())
      return "Local cleanup is pending. Finish resetting this device before syncing.";
    const authClient = supabaseAuthClient;
    if (!workspace || !authClient) return "Sign in and configure the Recall API before syncing.";
    if (!mediaStore) return "Local media storage is not ready yet. Try syncing again shortly.";
    const sessionResult = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: () => ({ _tag: "SessionReadError" }) as const,
        }),
      ),
    );
    if (Either.isLeft(sessionResult)) return "Your sign-in session could not be read.";
    const session = sessionResult.right.data.session;
    const token = session?.access_token;
    const canonicalId = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
    if (!token || Either.isLeft(canonicalId)) return "Sign in again before syncing.";
    const ownerId = canonicalId.right.toLowerCase();
    const isCurrent = () =>
      authSession.current.generation === authGeneration &&
      authSession.current.userId === ownerId &&
      authSession.current.token === token &&
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked();
    if (!isCurrent()) return "Your account session changed. Sync again with the current account.";
    const baseline = workspaceRef.current;
    if (!baseline) return "The local workspace is unavailable.";
    const synced = await Effect.runPromise(
      Effect.either(
        syncNativeWorkspace(
          baseline,
          token,
          () => Crypto.randomUUID(),
          mediaStore,
          (remoteOwnerId) =>
            makeNativeWorkspaceMediaGateway(
              process.env.EXPO_PUBLIC_RECALL_API_URL ?? "",
              async () => (isCurrent() ? token : null),
              remoteOwnerId,
              isCurrent,
            ),
          {
            expectedOwnerId: ownerId,
            adoptLegacyOwner,
            isCurrent,
            checkpoint: (bound) =>
              commitWorkspaceChange(
                (current) => {
                  if (!isCurrent())
                    return Effect.fail({
                      _tag: "WorkspaceSyncFailure",
                      reason: "account-changed",
                    } as const);
                  return bindWorkspaceOwner(current, bound.syncOwnerId, adoptLegacyOwner);
                },
                generation,
                { persistFirst: true, retainBindingOnAuthChange: true, isCurrent },
              ).pipe(Effect.mapError(() => ({ _tag: "WorkspaceSyncCheckpointFailure" }) as const)),
          },
        ),
      ),
    );
    if (workspaceLifetime.generation() !== generation || workspaceLifetime.isBlocked())
      return "This sync was discarded because the local workspace was reset or deleted.";
    if (!isCurrent())
      return "This sync was discarded because your account session changed. Offline data remains available.";
    if (Either.isLeft(synced)) {
      const reason = synced.left.reason;
      if (reason === "account-mismatch" || reason === "owner-adoption-required") {
        setSyncOwnershipIssue(reason);
        return reason === "account-mismatch"
          ? "This workspace belongs to another account. Keep it offline or export a backup before resetting for this account."
          : "This legacy workspace has cloud sync history but no recorded account owner. Confirm its account before syncing.";
      }
      if (reason === "ownership-checkpoint")
        return "Workspace account ownership could not be saved. No sync uploads were started; your offline data remains available.";
      if (reason === "deleted-review-content-missing")
        return "A pending review refers to deleted content that this older workspace no longer contains. Export this device's current private backup or review snapshot before replacing it with an older backup containing that card. Your reviews remain saved; backups are not automatically merged.";
      if (reason === "deleted-review-provision-capacity")
        return "Cloud content and pending deleted-review content exceed this area's card or objective limits. Local cards and reviews remain saved. Export a private backup before changing cloud content to free capacity.";
      return "Sync failed. Your current offline data remains available.";
    }
    setSyncOwnershipIssue(null);
    if (synced.right._tag === "ContentConflict") {
      syncConflictGeneration.current = generation;
      syncConflictAuthGeneration.current = authGeneration;
      setSyncConflictWorkspace(synced.right.workspace);
      return "A server content change needs your review. Compare the area list below before loading it.";
    }
    const result = synced.right;
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => applyWorkspaceSyncChanges(current, result, () => Crypto.randomUUID()),
          generation,
          { isCurrent },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      if (committed.left._tag === "NativeWorkspacePersistenceFailed") {
        setCacheWritable(false);
        return "Sync progress could not be saved locally. The received changes remain in this session.";
      }
      return "Sync could not reconcile the latest local workspace. Your current data was preserved.";
    }
    setSyncConflictWorkspace(null);
    if ((committed.right.syncContentConflictAreaIds ?? []).length > 0)
      return "Your newer local edits were preserved. Sync again to review conflicting server content.";
    if (
      (committed.right.syncPendingContentAreaIds ?? []).length > 0 &&
      !synced.right.hasMore &&
      !synced.right.uploadDeferred
    )
      return "Your newer local edits were preserved. Sync again to upload them.";
    if (synced.right.hasMore)
      return "Sync progress saved. More remote changes remain; sync again to continue.";
    if (synced.right.uploadDeferred)
      return (committed.right.retainedReviewAreas ?? []).length > 0
        ? "Reviews and deletion acknowledgements are still syncing. Deleted content stays hidden; sync again to finish."
        : "Sync progress received. Sync again to finish content and local uploads.";
    const remainingPendingReviews = committed.right.pendingReviewEventIds?.length ?? 0;
    if (remainingPendingReviews > 0)
      return `Sync progress saved. ${remainingPendingReviews} pending review${remainingPendingReviews === 1 ? " remains" : "s remain"}; sync again to continue.`;
    return "Your decks and reviews are synced.";
  }

  async function useServerWorkspace(): Promise<string> {
    if (!syncConflictWorkspace) return "There is no server version awaiting review.";
    const preview = syncConflictWorkspace;
    const ownerId = preview.syncOwnerId;
    const generation = syncConflictGeneration.current;
    if (
      generation === null ||
      generation !== workspaceLifetime.generation() ||
      syncConflictAuthGeneration.current !== authSession.current.generation ||
      !ownerId ||
      preview.syncOwnerId !== authSession.current.userId ||
      workspaceLifetime.isBlocked()
    )
      return "This server preview belongs to a workspace that was reset or deleted. Sync again.";
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            applyWorkspaceContentConflict(current, {
              ownerId,
              areas: preview.areas,
              hashes: preview.syncContentHashes ?? {},
              deletedAreaIds: (preview.deletedAreas ?? [])
                .filter((item) => item.synced)
                .map((item) => item.areaId),
            }),
          generation,
          {
            isCurrent: () =>
              syncConflictAuthGeneration.current === authSession.current.generation &&
              preview.syncOwnerId === authSession.current.userId,
          },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      if (committed.left._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      return "Server content could not be saved. Your review history remains in this session.";
    }
    setActiveAreaId(committed.right.areas[0]?.id ?? null);
    setSyncConflictWorkspace(null);
    return "Server content loaded. Sync again to upload pending reviews.";
  }

  async function importKnowledgeArea(format?: "csv" | "tsv"): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    const latest = workspaceRef.current;
    if (!latest) return "Your library is still loading.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const areaColors = [palette.green, palette.coral, palette.violet, palette.amber];
    const color = areaColors[latest.areas.length % areaColors.length] ?? palette.green;
    const imported = await Effect.runPromise(
      Effect.either(pickKnowledgeArea(color, () => Crypto.randomUUID(), format)),
    );
    if (Either.isLeft(imported))
      return format
        ? "Import failed. Choose a valid CSV/TSV with question and answer columns, at most 500 cards and 200 objective labels. Large text files and malformed quoted fields are rejected."
        : "Import failed. Choose a valid Deck JSON or media ZIP file smaller than 25 MB.";
    const proposal = imported.right;
    if (!proposal) return "Import canceled.";
    {
      const accepted = await new Promise<boolean>((resolve) => {
        Alert.alert(
          format ? `Import ${format.toUpperCase()} cards?` : "Import deck package?",
          `${proposal.area.title}\n${proposal.area.cards.length} cards · ${proposal.area.objectives?.length ?? 0} objectives\n\nA separate deck will be added with fresh identities and schedules. Tags and objective labels are preserved. ${format ? "Attachments and review history are not imported." : "Packaged attachments are included; review history starts fresh."} Your existing library stays available.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Import", onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!accepted) return "Import canceled.";
    }
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => Effect.succeed({ ...current, areas: [...current.areas, proposal.area] }),
          generation,
          {
            persistFirst: true,
            media: proposal.media,
            isCurrent: () => authSession.current.generation === authGeneration,
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      if (saved.left._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      return saved.left._tag === "NativeWorkspaceUnavailable"
        ? "Import discarded because this workspace or account changed."
        : "The area was not imported because its workspace or attachments could not be saved.";
    }
    setActiveAreaId(proposal.area.id);
    setNow(Date.now());
    return `${proposal.area.title} imported. Its review history and schedule start fresh.`;
  }

  async function exportActiveArea(format?: "csv" | "tsv"): Promise<string> {
    const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
    if (!area) return "There is no deck to export.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const result = await Effect.runPromise(
      Effect.either(shareKnowledgeArea(area, mediaStore, format)),
    );
    return Either.isRight(result)
      ? `${area.title} is ready to share.`
      : "The deck could not be exported.";
  }

  async function restorePrivateBackup(): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (!store || !mediaStore) return "Local workspace or attachment storage is unavailable.";
    const selected = await Effect.runPromise(Effect.either(pickWorkspaceBackup()));
    if (Either.isLeft(selected)) return "The private backup is invalid or could not be read.";
    const backup = selected.right;
    if (!backup) return "Restore canceled.";
    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Replace this workspace?",
        "The backup will replace decks, review history, schedules and local attachments. Its saved cloud account binding is retained.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Restore backup", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!accepted) return "Restore canceled.";
    if (
      workspaceLifetime.generation() !== generation ||
      authSession.current.generation !== authGeneration ||
      workspaceLifetime.isBlocked()
    )
      return "Restore discarded because this workspace or account changed.";
    invalidateWorkspaceOperations();
    syncConflictGeneration.current = null;
    syncConflictAuthGeneration.current = null;
    setSyncConflictWorkspace(null);
    const restoreGeneration = workspaceLifetime.generation();
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => {
            const owner = backup.workspace.syncOwnerId;
            const activeOwner = authSession.current.userId;
            if (
              owner &&
              ((current.syncOwnerId && current.syncOwnerId !== owner) ||
                (activeOwner && activeOwner !== owner))
            )
              return Effect.fail({
                _tag: "WorkspaceSyncFailure",
                reason: "account-mismatch",
              } as const);
            if (!owner && current.syncOwnerId && workspaceHasRemoteSyncMetadata(backup.workspace))
              return Effect.fail({
                _tag: "WorkspaceSyncFailure",
                reason: "account-mismatch",
              } as const);
            return current.syncOwnerId && !owner
              ? bindWorkspaceOwner(backup.workspace, current.syncOwnerId)
              : Effect.succeed(backup.workspace);
          },
          restoreGeneration,
          {
            persistFirst: true,
            restoreWrite: true,
            media: backup.media,
            isCurrent: () => authSession.current.generation === authGeneration,
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      if (saved.left._tag === "WorkspaceSyncFailure")
        return "This backup has a different or unconfirmed cloud owner. Keep the current workspace, export it, then sign in to the backup owner or reset to restore it offline.";
      return "The workspace could not be replaced. The previous workspace remains available.";
    }
    setActiveAreaId(saved.right.areas[0]?.id ?? null);
    setMediaUris({});
    setShowAnswer(false);
    setCacheWritable(true);
    setMessage(null);
    return "Private backup restored, including its account binding, reviews, schedules and attachments.";
  }

  async function exportPrivateBackup(): Promise<string> {
    if (!workspace || !mediaStore) return "Workspace or attachment storage is unavailable.";
    if (!libraryNotes.loaded)
      return "Wait for learning activities to load before exporting a complete backup.";
    const merged = Effect.runSync(
      Effect.either(
        mergeActivityLibraries(
          workspace.activityLibrary ?? emptyActivityLibrary,
          libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
        ),
      ),
    );
    if (Either.isLeft(merged)) return merged.left.message;
    const result = await Effect.runPromise(
      Effect.either(
        shareWorkspaceBackup(
          {
            ...workspace,
            activityLibrary: merged.right,
          },
          mediaStore,
        ),
      ),
    );
    return Either.isRight(result)
      ? "Private workspace backup is ready to share."
      : "The private workspace backup could not be exported.";
  }

  async function exportAccountData(): Promise<string> {
    const result = await Effect.runPromise(Effect.either(exportNativeAccountData(workspace)));
    return Either.isRight(result)
      ? "Account export is ready to save or share."
      : "Account export could not be prepared. Check your connection and try again.";
  }

  async function deleteAccountData(): Promise<string> {
    if (workspaceLifetime.isBlocked())
      return "Local cleanup is already pending. Finish resetting this device first.";
    const targets = captureCleanupTargets();
    invalidateWorkspaceOperations();
    workspaceLifetime.pauseWrites();
    syncConflictGeneration.current = null;
    setSyncConflictWorkspace(null);
    const cloudDeleted = await Effect.runPromise(Effect.either(deleteNativeAccount()));
    if (Either.isLeft(cloudDeleted)) {
      workspaceLifetime.resumeWrites();
      return "Account deletion failed. Your account and local data remain available.";
    }

    const localCleanup = await Effect.runPromise(
      Effect.gen(function* () {
        const workspaceAndMedia =
          store && mediaStore
            ? yield* withNativeOperationStoreLane(clearLocalStores.current)
            : { workspaceCleared: false, mediaCleared: false };
        const auxiliary = yield* clearAuxiliaryNativeData(targets);
        return {
          ...workspaceAndMedia,
          ...auxiliary,
        } as const;
      }),
    );
    const authClient = supabaseAuthClient;
    const signedOut = authClient
      ? await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => authClient.auth.signOut({ scope: "local" }),
              catch: () => ({ _tag: "LocalSignOutFailure" }) as const,
            }),
          ),
        )
      : null;
    workspaceRef.current = null;
    setWorkspaceState(null);
    setActiveAreaId(null);
    setShowAnswer(false);
    if (
      !localCleanup.workspaceCleared ||
      !localCleanup.mediaCleared ||
      !localCleanup.tutorSessionsCleared ||
      !localCleanup.pendingOperationsCleared
    ) {
      return "Account deleted. This device could not remove all local data; clear it before lending or recycling the device.";
    }
    if (signedOut && (Either.isLeft(signedOut) || signedOut.right.error)) {
      return "Account and local data deleted, but this device could not clear its saved sign-in session.";
    }
    return "Account and synced data deleted. This device’s workspace and attachments were removed.";
  }

  async function addPublishedFork(
    document: import("@recall/domain").KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ): Promise<boolean> {
    if (!store || !cacheWritable) return false;
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.gen(function* () {
              const existing = current.areas.find((item) => item.id === document.id);
              if (existing) {
                if (existing.forkedFromVersionId !== forkedFromVersionId)
                  return yield* Effect.fail({ _tag: "NativeForkConflict" } as const);
                return yield* retainPublishedActivityDefinitions(current, document);
              }
              const imported = yield* fromKnowledgeArea(
                { ...document, attribution, licence: license, forkedFromVersionId },
                [palette.green, palette.coral, palette.violet, palette.amber][
                  current.areas.length % 4
                ] ?? palette.green,
                true,
                () => Crypto.randomUUID(),
                new Date(),
                true,
              );
              return yield* retainPublishedActivityDefinitions(
                {
                  ...current,
                  areas: [...current.areas, imported],
                  syncContentHashes: {
                    ...(current.syncContentHashes ?? {}),
                    [imported.id]: contentHash,
                  },
                },
                document,
              );
            }),
          operationGeneration,
          {
            persistFirst: true,
            mediaForWorkspace: (next) => {
              const retainedArea = next.areas.find((item) => item.id === document.id);
              const requiredMedia = new Set(
                retainedArea?.cards.flatMap((card) => card.media?.map((item) => item.id) ?? []) ??
                  [],
              );
              return assets.filter((asset) => requiredMedia.has(asset.reference.id));
            },
          },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      setMessage(
        "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
      );
      return false;
    }
    setActiveAreaId(document.id);
    setShowAnswer(false);
    return true;
  }

  async function approveTutorProposal(
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
  ): Promise<{ readonly cardId: string; readonly content: CardProposal } | null> {
    const generation = operationGeneration;
    const authGeneration = authSession.current.generation;
    if (!activeArea || !store || !cacheWritable) {
      setMessage("Local storage must be available before approving an AI card.");
      return null;
    }
    const areaId = activeArea.id;
    const isCurrent = () =>
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked() &&
      authSession.current.generation === authGeneration;
    const saved = await Effect.runPromise(
      Effect.either(
        workspaceChangeLane.withPermits(1)(
          Effect.gen(function* () {
            const current = workspaceRef.current;
            if (!current || !isCurrent())
              return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
            const approved = yield* persistTutorCardApproval(
              store,
              current,
              { areaId, proposal, proposalId, sessionId },
              new Date(),
            );
            if (!isCurrent())
              return yield* Effect.fail({ _tag: "NativeWorkspaceUnavailable" } as const);
            setWorkspace(approved.workspace);
            return approved;
          }),
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      setMessage(
        saved.left._tag === "NativeWorkspaceUnavailable"
          ? "Approval was discarded because this workspace or account changed. Retry in the current session."
          : saved.left.message,
      );
      return null;
    }
    return { cardId: saved.right.cardId, content: saved.right.proposal };
  }

  async function applyAuthoringCommand(
    command: unknown,
    expectedBaseline?: string,
    stagedMedia: readonly StoredMediaAsset[] = [],
  ): Promise<{ readonly ok: boolean; readonly message: string }> {
    const generation = operationGeneration;
    const authGeneration = authSession.current.generation;
    if (reviewInProgress.current)
      return { ok: false, message: "Wait for the pending review to save before editing." };
    if (!store || !cacheWritable || workspaceLifetime.isBlocked())
      return {
        ok: false,
        message:
          "Your changes can’t be saved yet. Finish the device reset or reopen the app before editing. Your cards are still available.",
      };
    if (stagedMedia.length > 20 || stagedMedia.some((asset) => !verifyMediaAsset(asset)))
      return { ok: false, message: "Attachments could not be verified. Choose the files again." };
    const isCurrent = () =>
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked() &&
      authSession.current.generation === authGeneration;
    let selectedAreaId: string | undefined;
    let successMessage = "Changes saved.";
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            applyWorkspaceAuthoringCommand(current, command, new Date(), expectedBaseline).pipe(
              Effect.map((result) => {
                selectedAreaId = result.selectedAreaId;
                successMessage = result.message;
                return result.workspace;
              }),
            ),
          generation,
          {
            persistFirst: true,
            retainBindingOnAuthChange: true,
            isCurrent,
            mediaForWorkspace: (next) =>
              stagedMedia.filter((asset) =>
                next.areas.some((area) =>
                  area.cards.some((card) =>
                    card.media?.some(
                      (reference) =>
                        reference.id === asset.reference.id &&
                        reference.mimeType === asset.reference.mimeType &&
                        reference.byteLength === asset.reference.byteLength,
                    ),
                  ),
                ),
              ),
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      const failure = saved.left;
      if (failure._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      const notice =
        failure._tag === "WorkspaceAuthoringFailure"
          ? failure.message
          : failure._tag === "NativeWorkspaceUnavailable"
            ? failure.persisted
              ? "Changes were saved locally before your account changed. Review the current library before retrying your draft."
              : "This workspace or account changed. Review your draft before trying again."
            : "Save not confirmed. The draft is still here. Free device storage or reopen the app, then retry saving.";
      setMessage(notice);
      return { ok: false, message: notice };
    }
    if (!isCurrent())
      return {
        ok: false,
        message:
          "The save finished before this workspace or account changed. Review the current library before retrying your draft.",
      };
    const preferred = selectedAreaId ?? activeAreaId;
    setActiveAreaId(
      saved.right.areas.some((area) => area.id === preferred)
        ? (preferred ?? null)
        : (saved.right.areas[0]?.id ?? null),
    );
    setShowAnswer(false);
    setMediaUris({});
    setNow(Date.now());
    setMediaRevision((revision) => revision + 1);
    const decodedCommand = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
    if (Either.isRight(decodedCommand) && decodedCommand.right.kind === "update-card") {
      const editedId = decodedCommand.right.cardId;
      libraryNotes.update((notes) => ({
        ...notes,
        flaggedCardIds: notes.flaggedCardIds.filter((id) => id !== editedId),
      }));
    }
    setMessage(successMessage);
    return { ok: true, message: successMessage };
  }
  const authoringDisabledReason = workspaceLifetime.isBlocked()
    ? "Local cleanup is pending. Finish resetting this device before editing."
    : !ready || !workspace
      ? "Your local library is loading."
      : !store || !cacheWritable
        ? "Local storage is unavailable or read-only. Existing content remains available."
        : reviewPending
          ? "Wait for the pending review to save before editing."
          : undefined;

  function startStudy(areaId: string) {
    if (reviewPending || workspaceLifetime.isBlocked()) return;
    setActiveAreaId(areaId);
    setStudySession({ areaId, events: [] });
    setShowAnswer(false);
    setMediaUris({});
    setNow(Date.now());
    setActiveTab(AppTab.Today);
  }
  async function importCards(format?: "csv" | "tsv") {
    if (importingCards) return;
    setImportingCards(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => importKnowledgeArea(format),
          catch: () => ({ _tag: "NativeCardImportUnavailable" }) as const,
        }),
      ),
    );
    setMessage(Either.isRight(result) ? result.right : "Cards could not be imported. Try again.");
    setImportingCards(false);
    if (Either.isRight(result) && result.right.includes("imported.")) setShowImportChoices(false);
  }
  async function runLibraryTransfer(action: () => Promise<string>) {
    if (transferPending) return;
    setTransferPending(true);
    const outcome = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: action,
          catch: () => ({
            message: "The file action couldn’t finish. Your workspace is unchanged. Try again.",
          }),
        }),
      ),
    );
    setMessage(Either.isRight(outcome) ? outcome.right : outcome.left.message);
    setTransferPending(false);
  }
  const authoringPanel = (
    <View className="gap-4">
      <NativeButton
        tone="soft"
        label={searchOpen ? "Close search" : "Search everything"}
        disabled={!ready || reviewPending || workspaceLifetime.isBlocked()}
        onPress={() => setSearchOpen((value) => !value)}
      />
      {searchOpen && (
        <NativeWorkspaceSearchPanel
          key={`${operationGeneration}:${workspace?.syncOwnerId ?? "local"}`}
          workspace={workspace}
          disabled={!ready || reviewPending || workspaceLifetime.isBlocked()}
          onNavigate={(result) => {
            if (
              workspaceLifetime.isBlocked() ||
              reviewPending ||
              !workspaceRef.current?.areas.some((item) => item.id === result.areaId)
            )
              return;
            setActiveAreaId(result.areaId);
            setSearchTarget(result);
            setShowAnswer(false);
            setSearchOpen(false);
            setActiveTab(
              ["area", "card", "objective"].includes(result.target.kind)
                ? AppTab.Library
                : AppTab.Tutor,
            );
          }}
        />
      )}
      <View className="gap-2">
        <NativeButton
          label="Export deck"
          tone="soft"
          disabled={reviewPending || !activeArea || transferPending}
          onPress={() => {
            setLibraryTransfer("export");
            setShowImportChoices(false);
          }}
        />
        <NativeButton
          label="Workspace backup"
          tone="soft"
          disabled={reviewPending || transferPending}
          onPress={() => {
            setLibraryTransfer("backup");
            setShowImportChoices(false);
          }}
        />
      </View>
      {libraryTransfer && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">
            {libraryTransfer === "export" ? "Export deck" : "Workspace backup"}
          </Text>
          <Text className="text-sm text-recall-muted">
            {libraryTransfer === "export"
              ? `Export ${activeArea?.title ?? "the selected deck"}. CSV/TSV contains text and tags; deck packages also include attachments. Reviews stay private.`
              : "Backups include decks, schedules, review history and attachments. Restoring replaces the workspace. Drafts and editing flags are stored separately."}
          </Text>
          {libraryTransfer === "export" ? (
            <>
              <NativeButton
                label="Export CSV"
                disabled={transferPending}
                onPress={() => void runLibraryTransfer(() => exportActiveArea("csv"))}
              />
              <NativeButton
                label="Export TSV"
                tone="soft"
                disabled={transferPending}
                onPress={() => void runLibraryTransfer(() => exportActiveArea("tsv"))}
              />
              <NativeButton
                label="Export deck package"
                tone="soft"
                disabled={transferPending}
                onPress={() => void runLibraryTransfer(() => exportActiveArea())}
              />
            </>
          ) : (
            <>
              <NativeButton
                label="Save workspace backup"
                disabled={transferPending}
                onPress={() => void runLibraryTransfer(exportPrivateBackup)}
              />
              <NativeButton
                label="Restore workspace backup"
                tone="soft"
                disabled={transferPending}
                onPress={() => void runLibraryTransfer(restorePrivateBackup)}
              />
            </>
          )}
          {message && <Text accessibilityRole="alert">{message}</Text>}
          <NativeButton
            label="Close file tools"
            tone="soft"
            disabled={transferPending}
            onPress={() => setLibraryTransfer(null)}
          />
        </View>
      )}
      {showImportChoices && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold text-recall-ink">Import cards</Text>
          <Text className="text-sm text-recall-muted">
            Imports are validated and added as a separate deck. Review the destination and card
            count before saving.
          </Text>
          <NativeButton
            label="Import Anki deck"
            disabled={importingCards || reviewPending}
            onPress={() => {
              setShowImportChoices(false);
              void importAnkiDeck();
            }}
          />
          <NativeButton
            label="Import CSV"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={() => void importCards("csv")}
          />
          <NativeButton
            label="Import TSV"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={() => void importCards("tsv")}
          />
          <NativeButton
            label="Import deck package"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={() => void importCards()}
          />
          <NativeButton
            label="Close import"
            tone="soft"
            disabled={importingCards}
            onPress={() => setShowImportChoices(false)}
          />
          {message && (
            <Text accessibilityRole="alert" className="text-sm text-recall-muted">
              {message}
            </Text>
          )}
        </View>
      )}
      {(libraryNotes.error || activityRestoreError) && (
        <View className="gap-2">
          <Text accessibilityRole="alert">{libraryNotes.error ?? activityRestoreError}</Text>
          <NativeButton label="Retry draft save" onPress={libraryNotes.retry} />
        </View>
      )}
      <NativeWorkspaceAuthoringPanel
        flaggedOnly={onlyFlagged}
        onFlaggedFilterChange={setOnlyFlagged}
        notes={libraryNotes.notes}
        notesLoaded={libraryNotes.loaded}
        onFlushDraft={libraryNotes.flush}
        onRetainDraft={(draft, assets) =>
          libraryNotes.update((notes) => retainLibraryDraft(notes, draft), assets)
        }
        onDiscardDraft={(key) => libraryNotes.update((notes) => discardLibraryDraft(notes, key))}
        onFlag={(id) => libraryNotes.update((notes) => toggleCardFlag(notes, id))}
        onSelectDeck={(id) => {
          setOnlyFlagged(false);
          setActiveAreaId(id);
          setSearchTarget(null);
          setShowAnswer(false);
        }}
        now={now}
        onStudy={startStudy}
        onImportCards={() => {
          setLibraryTransfer(null);
          setShowImportChoices(true);
        }}
        onGenerateCards={() => {
          setTutorActivity("materials");
          setSearchTarget(null);
          setActiveTab(AppTab.Tutor);
        }}
        workspace={workspace}
        activeAreaId={activeAreaId}
        tutorApi={tutorApi}
        disabled={authoringDisabledReason !== undefined}
        {...(authoringDisabledReason === undefined
          ? {}
          : { disabledReason: authoringDisabledReason })}
        createId={Crypto.randomUUID}
        onPickAttachment={pickNativeMedia}
        onCommand={applyAuthoringCommand}
        searchTarget={searchTarget}
      />
      {activeArea && (
        <NativeLearningActivitiesPanel
          key={`activities:${notesStore.scope}:${activeArea.id}`}
          areaId={activeArea.id}
          {...(learningActivityId ? { initialActivityId: learningActivityId } : {})}
          cards={activeArea.cards}
          {...(activityServices ? { services: activityServices } : {})}
          objectives={activeArea.objectives ?? []}
          {...(libraryNotes.notes.activityLibrary
            ? { library: libraryNotes.notes.activityLibrary }
            : {})}
          disabled={
            deckUpdateInProgress || !libraryNotes.loaded || authoringDisabledReason !== undefined
          }
          createId={Crypto.randomUUID}
          onSave={(activityLibrary) => {
            if (
              workspaceLifetime.isBlocked() ||
              workspaceLifetime.generation() !== operationGeneration ||
              !libraryNotes.loaded ||
              authoringDisabledReason !== undefined
            )
              return Promise.resolve(false);
            let valid = true;
            libraryNotes.update((notes) => {
              const merged = Effect.runSync(
                Effect.either(
                  mergeActivityLibraries(
                    activityLibrary,
                    notes.activityLibrary ?? emptyActivityLibrary,
                  ),
                ),
              );
              if (Either.isLeft(merged)) {
                valid = false;
                return notes;
              }
              return { ...notes, activityLibrary: merged.right };
            });
            return valid ? libraryNotes.flush() : Promise.resolve(false);
          }}
        />
      )}
    </View>
  );
  const tutorPanel =
    activePublishingArea && Either.isRight(activePublishingArea) ? (
      <NativeTutorPanel
        initialActivity={tutorActivity}
        key={`${activeArea?.id ?? "no-area"}:${tutorActivity ?? "practice"}`}
        area={activePublishingArea.right}
        duplicateCandidates={workspace ? workspaceDuplicateCandidates(workspace) : []}
        {...(searchTarget && searchTarget.areaId === activeArea?.id
          ? { searchTarget: searchTarget.target }
          : {})}
        reviewEvents={workspace?.reviewEvents ?? []}
        mayWrite={() =>
          !workspaceLifetime.isBlocked() &&
          workspaceLifetime.generation() === operationGeneration &&
          cacheWritable
        }
        objectiveGaps={
          activeArea
            ? identifyObjectiveGaps(activeArea, workspace?.reviewEvents ?? [], new Date(now))
            : []
        }
        api={tutorApi}
        createId={() => Crypto.randomUUID()}
        initialSessionId={nativeTutorSessionId}
        onSessionIdChange={(sessionId) => {
          if (
            !activeArea ||
            workspaceLifetime.isBlocked() ||
            workspaceLifetime.generation() !== operationGeneration
          )
            return;
          setNativeTutorSessionIds((current) => ({ ...current, [activeArea.id]: sessionId }));
          void Effect.runPromise(
            Effect.either(
              writeNativeTutorSessionId(
                activeArea.id,
                sessionId,
                () =>
                  !workspaceLifetime.isBlocked() &&
                  workspaceLifetime.generation() === operationGeneration,
              ),
            ),
          );
        }}
        onApproveProposal={approveTutorProposal}
        onStartReview={() => {
          if (activeArea) startStudy(activeArea.id);
        }}
      />
    ) : null;
  const deepPracticeRecommendations = (workspace?.areas ?? [])
    .flatMap((item) =>
      recommendLearningActivities(
        libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
        item.id,
        now,
      ),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority || left.activity.id.localeCompare(right.activity.id, "en"),
    )
    .slice(0, 3);
  const activityDefinitionSnapshot = (
    notes: NonNullable<ReturnType<typeof libraryNotes.getCurrentNotes>>,
    areaId: string,
  ) =>
    JSON.stringify(
      (notes.activityLibrary?.activities ?? [])
        .filter((activity) => activity.areaId === areaId && !activity.archived)
        .sort((left, right) => left.id.localeCompare(right.id, "en")),
    );
  async function saveDeckUpdate(
    updatedArea: import("@recall/domain").KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
  ): Promise<boolean> {
    if (deckUpdateInProgressRef.current) return false;
    const expectedAreaId = activeArea?.id;
    const expectedPortable = activeArea
      ? Effect.runSync(Effect.either(toKnowledgeArea(activeArea, true, true)))
      : null;
    const expectedAreaSnapshot =
      expectedPortable && Either.isRight(expectedPortable)
        ? JSON.stringify(expectedPortable.right)
        : null;
    const expectedGeneration = operationGeneration;
    const expectedOwner = accountUserId;
    const invocationNotes = libraryNotes.getCurrentNotes();
    if (
      !expectedAreaId ||
      updatedArea.id !== expectedAreaId ||
      !expectedAreaSnapshot ||
      !invocationNotes
    )
      return false;
    const expectedActivityDefinitions = activityDefinitionSnapshot(invocationNotes, expectedAreaId);
    deckUpdateInProgressRef.current = true;
    setDeckUpdateInProgress(true);
    try {
      const flushed = await libraryNotes.flush();
      const flushedNotes = libraryNotes.getCurrentNotes();
      if (
        !flushed ||
        !flushedNotes ||
        activityDefinitionSnapshot(flushedNotes, expectedAreaId) !== expectedActivityDefinitions
      )
        return false;
      return await persistDeckUpdate(
        updatedArea,
        versionId,
        advanceBaseline,
        assets,
        expectedAreaId,
        expectedAreaSnapshot,
        expectedGeneration,
        expectedOwner,
        expectedActivityDefinitions,
      );
    } finally {
      deckUpdateInProgressRef.current = false;
      setDeckUpdateInProgress(false);
    }
  }

  async function persistDeckUpdate(
    updatedArea: import("@recall/domain").KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
    expectedAreaId: string,
    expectedAreaSnapshot: string,
    expectedGeneration: number,
    expectedOwner: string | null,
    expectedActivityDefinitions: string,
  ): Promise<boolean> {
    if (!store || !cacheWritable) return false;
    const workspaceIsCurrent = () =>
      !workspaceLifetime.isBlocked() &&
      workspaceLifetime.generation() === expectedGeneration &&
      activeAreaIdRef.current === expectedAreaId &&
      authSession.current.userId === expectedOwner;
    const activityDefinitionsAreCurrent = () => {
      const latest = libraryNotes.getCurrentNotes();
      return (
        latest !== null &&
        activityDefinitionSnapshot(latest, expectedAreaId) === expectedActivityDefinitions
      );
    };
    const isCurrent = () => workspaceIsCurrent() && activityDefinitionsAreCurrent();
    if (!isCurrent()) return false;
    const result = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            Effect.gen(function* () {
              const currentArea = current.areas.find((item) => item.id === expectedAreaId);
              if (!currentArea)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              const latestNotes = libraryNotes.getCurrentNotes();
              if (!latestNotes)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateInvalid" } as const);
              if (
                activityDefinitionSnapshot(latestNotes, expectedAreaId) !==
                expectedActivityDefinitions
              )
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              const latestActivityLibrary = yield* mergeActivityLibraries(
                current.activityLibrary ?? emptyActivityLibrary,
                latestNotes.activityLibrary ?? emptyActivityLibrary,
              ).pipe(Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const));
              const currentDocument = yield* toKnowledgeArea(currentArea, true, true).pipe(
                Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const),
              );
              if (JSON.stringify(currentDocument) !== expectedAreaSnapshot)
                return yield* Effect.fail({ _tag: "NativeDeckUpdateStale" } as const);
              return yield* applyDeckWorkspaceUpdate(
                {
                  workspace: { ...current, activityLibrary: latestActivityLibrary },
                  updatedArea,
                  newVersionId: versionId,
                  advanceBaseline,
                  expectedCurrentAreaContentFingerprint: publicationContentHash(currentDocument),
                },
                new Date(),
                () => Crypto.randomUUID(),
              );
            }),
          expectedGeneration,
          {
            persistFirst: true,
            isCurrent,
            mediaForWorkspace: (next) => {
              const area = next.areas.find((item) => item.id === expectedAreaId);
              const required = new Set(
                area?.cards.flatMap((card) => card.media?.map((reference) => reference.id) ?? []) ??
                  [],
              );
              return assets.filter((asset) => required.has(asset.reference.id));
            },
          },
        ),
      ),
    );
    if (Either.isLeft(result) || !isCurrent()) {
      if (
        Either.isLeft(result) &&
        result.left._tag === "NativeWorkspaceUnavailable" &&
        workspaceIsCurrent() &&
        !activityDefinitionsAreCurrent()
      ) {
        await Effect.runPromise(
          Effect.either(
            commitWorkspaceChange(
              (current) =>
                Effect.gen(function* () {
                  const latestNotes = libraryNotes.getCurrentNotes();
                  if (!latestNotes)
                    return yield* Effect.fail({ _tag: "NativeDeckUpdateInvalid" } as const);
                  const latestActivityLibrary = yield* mergeActivityLibraries(
                    current.activityLibrary ?? emptyActivityLibrary,
                    latestNotes.activityLibrary ?? emptyActivityLibrary,
                  ).pipe(Effect.mapError(() => ({ _tag: "NativeDeckUpdateInvalid" }) as const));
                  return { ...current, activityLibrary: latestActivityLibrary };
                }),
              expectedGeneration,
              { persistFirst: true, isCurrent: workspaceIsCurrent },
            ),
          ),
        );
      }
      return false;
    }
    const savedLibrary = result.right.activityLibrary;
    if (savedLibrary) {
      libraryNotes.update((notes) => {
        const merged = Effect.runSync(
          Effect.either(
            mergeActivityLibraries(notes.activityLibrary ?? emptyActivityLibrary, savedLibrary),
          ),
        );
        if (Either.isLeft(merged)) {
          setActivityRestoreError(merged.left.message);
          return notes;
        }
        setActivityRestoreError(null);
        return { ...notes, activityLibrary: merged.right };
      });
    }
    return true;
  }
  return (
    <NativeAppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      areas={workspace?.areas ?? []}
      activeAreaId={activeAreaId}
      selectionDisabled={reviewPending}
      onSelectArea={(areaId) => {
        setStudySession({ areaId, events: [] });
        setActiveAreaId(areaId);
        setShowAnswer(false);
        setMediaUris({});
      }}
      today={
        <NativeTodayScreen
          deepPractice={
            deepPracticeRecommendations.length > 0 ? (
              <View className="mt-5 gap-3">
                <Text className="text-xl font-bold">Deeper practice</Text>
                <Text className="text-sm text-recall-muted">
                  Longer activities build evidence beyond quick recall reviews.
                </Text>
                {deepPracticeRecommendations.map((recommendation) => (
                  <View
                    key={recommendation.activity.id}
                    className="gap-2 rounded-xl border border-recall-line p-4"
                  >
                    <Text className="font-bold">{recommendation.activity.title}</Text>
                    <Text className="text-sm text-recall-muted">
                      About {recommendation.estimatedMinutes} minutes · {recommendation.reason}
                    </Text>
                    <NativeButton
                      label="Start activity"
                      tone="soft"
                      disabled={!libraryNotes.loaded || authoringDisabledReason !== undefined}
                      onPress={() => {
                        setActiveAreaId(recommendation.activity.areaId);
                        setLearningActivityId(recommendation.activity.id);
                        setOnlyFlagged(false);
                        setActiveTab(AppTab.Library);
                      }}
                    />
                  </View>
                ))}
              </View>
            ) : null
          }
          flaggedCardIds={libraryNotes.notes.flaggedCardIds}
          onFlag={(id) => libraryNotes.update((notes) => toggleCardFlag(notes, id))}
          onEditFlagged={() => {
            setOnlyFlagged(true);
            setActiveTab(AppTab.Library);
          }}
          sessionEvents={
            studySession && studySession.areaId === activeArea?.id ? studySession.events : []
          }
          onNextDeck={() => {
            const next = workspace?.areas.find(
              (area) =>
                area.id !== activeArea?.id &&
                area.cards.some((card) => Date.parse(card.schedule.due) <= now),
            );
            if (next) startStudy(next.id);
          }}
          onOpenLibrary={() => setActiveTab(AppTab.Library)}
          ready={ready}
          workspace={workspace}
          activeAreaId={activeAreaId}
          now={now}
          message={message}
          mediaUris={mediaUris}
          showAnswer={showAnswer}
          reviewPending={reviewPending}
          canReset={store !== null}
          onSelectArea={startStudy}
          onHideAnswer={() => setShowAnswer(false)}
          onShowAnswer={() => setShowAnswer(true)}
          onReview={(rating) => void review(rating)}
          onReset={resetLocalWorkspace}
          onImportAnki={() => void importAnkiDeck()}
        />
      }
      library={authoringPanel}
      tutor={tutorPanel}
      sharing={
        <View className="gap-4">
          {deckSharingApi ? (
            <NativeDeckSharingPanel
              key={`deck-sharing-${accountUserId ?? "anonymous"}`}
              api={deckSharingApi}
              accountId={accountUserId}
              currentArea={
                activePublishingArea && Either.isRight(activePublishingArea)
                  ? {
                      id: activePublishingArea.right.id,
                      title: activePublishingArea.right.title,
                      ...(activePublishingArea.right.sourceId
                        ? { sourceId: activePublishingArea.right.sourceId }
                        : {}),
                      ...(activePublishingArea.right.forkedFromVersionId
                        ? { sourceVersionId: activePublishingArea.right.forkedFromVersionId }
                        : {}),
                    }
                  : null
              }
              onReviewVersion={(versionId, token) =>
                setSelectedDeckVersion({
                  versionId,
                  owner: accountUserId,
                  ...(token ? { token } : {}),
                })
              }
            />
          ) : (
            <Text className="text-sm text-recall-muted">
              Deck sharing is unavailable until the API URL is configured.
            </Text>
          )}
          <NativePublishingPanel
            key={`${accountUserId ?? "anonymous"}:${visibleSelectedDeckVersion?.versionId ?? activeArea?.id ?? "receive-shared-area"}`}
            forkOperationStore={nativeForkOperationStore}
            createForkOperationId={Crypto.randomUUID}
            publicationOperationStore={nativePublicationOperationStore}
            createPublishShareToken={() => encodePublicationShareToken(Crypto.getRandomBytes(32))}
            area={
              activePublishingArea && Either.isRight(activePublishingArea)
                ? activePublishingArea.right
                : null
            }
            lineageArea={
              activeKnowledgeArea && Either.isRight(activeKnowledgeArea)
                ? activeKnowledgeArea.right
                : null
            }
            mediaStore={mediaStore}
            {...(process.env.EXPO_PUBLIC_RECALL_API_URL?.trim()
              ? { clients: nativePublishingClients }
              : {})}
            {...(visibleSelectedDeckVersion
              ? {
                  initialVersionId: visibleSelectedDeckVersion.versionId,
                  initialToken: visibleSelectedDeckVersion.token,
                }
              : {})}
            onFork={async (...args) => {
              const forked = await addPublishedFork(...args);
              if (forked) setSelectedDeckVersion(null);
              return forked;
            }}
            onUpdate={saveDeckUpdate}
          />
        </View>
      }
      account={
        <>
          <NativeDailyReminderSettingsPanel controller={dailyReminders} />
          {accountUserId && (
            <NativeBudgetSettingsPanel key={accountUserId} accountId={`hosted:${accountUserId}`} />
          )}
          <NativeAccountPanel
            cloudAvailable={supabaseAuthClient !== null}
            account={accountEmail}
            onRequestSignIn={async (email) => {
              const result = await Effect.runPromise(Effect.either(sendNativeMagicLink(email)));
              return Either.isRight(result) && result.right
                ? "Check your email for a sign-in link."
                : "Could not send a sign-in link. Check your email and connection.";
            }}
            onSignOut={async () => {
              const client = supabaseAuthClient;
              if (!client) return "Cloud sign-out is unavailable on this device.";
              const result = await Effect.runPromise(
                Effect.either(
                  Effect.tryPromise({
                    try: () => client.auth.signOut(),
                    catch: () => ({ _tag: "SignOutRequestError" }) as const,
                  }),
                ),
              );
              return Either.isRight(result) && !result.right.error
                ? "Signed out. This device’s local study data remains available."
                : "Could not sign out. Your current account session is unchanged.";
            }}
            onSync={() => syncCloudWorkspace()}
            ownershipIssue={
              workspace?.syncOwnerId && accountUserId && workspace.syncOwnerId !== accountUserId
                ? "account-mismatch"
                : syncOwnershipIssue
            }
            onAdoptLegacyOwner={() => syncCloudWorkspace(true)}
            onResetForAccount={() =>
              Alert.alert(
                "Start a fresh workspace?",
                "Export a private backup first. Resetting removes this device’s saved workspace and attachments; cloud data is unchanged.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Reset local workspace",
                    style: "destructive",
                    onPress: resetLocalWorkspace,
                  },
                ],
              )
            }
            conflictAreas={syncConflictWorkspace?.areas.map((area) => area.title) ?? null}
            onUseServerVersion={useServerWorkspace}
            onImport={importKnowledgeArea}
            onExport={exportActiveArea}
            onImportDelimited={importKnowledgeArea}
            onExportDelimited={exportActiveArea}
            onBackupRestore={restorePrivateBackup}
            onBackupExport={exportPrivateBackup}
            onExportAccount={exportAccountData}
            onDeleteAccount={deleteAccountData}
          />
        </>
      }
    />
  );
}
