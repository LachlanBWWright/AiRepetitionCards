import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Alert } from "react-native";
import { Effect, Either, Schema } from "effect";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { File, Paths } from "expo-file-system";
import { designTokens } from "@recall/design-tokens";
import {
  clearWorkspaceAndMedia,
  applyWorkspaceSyncChanges,
  applyWorkspaceAuthoringCommand,
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
} from "@recall/application";
import type {
  AnkiImportProposal,
  WorkspaceMediaCommitFailure,
  WorkspaceMediaClearResult,
} from "@recall/application";
import { newSchedule, type ReviewRating } from "@recall/scheduler";
import type { StudyCard, Workspace } from "@recall/domain";
import { createAreaId, createCardId, createObjectiveId } from "@recall/domain";
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
import {
  pickKnowledgeArea,
  pickWorkspaceBackup,
  shareKnowledgeArea,
  shareWorkspaceBackup,
} from "./src/storage/native-interchange";
import { NativeWorkspaceAuthoringPanel } from "./src/components/NativeWorkspaceAuthoringPanel";
import { NativeTodayScreen } from "./src/components/NativeTodayScreen";
import { NativeAppShell } from "./src/components/NativeAppShell";
import { NativeAccountPanel } from "./src/components/NativeAccountPanel";
import { pickAnkiImport } from "./src/storage/native-anki-import";
import { pickNativeMedia } from "./src/storage/native-media-picker";
import { NativePublishingPanel } from "./src/components/NativePublishingPanel";
import { createNativeForkOperationStore } from "./src/storage/native-fork-operation-store";
import { createNativePublicationOperationStore } from "./src/storage/native-publication-operation-store";
import { clearNativePendingOperations } from "./src/storage/native-operation-store";
import { createNativeWorkspaceLifetime } from "./src/storage/native-workspace-lifetime";
import { encodePublicationShareToken } from "@recall/application";
import { identifyObjectiveGaps } from "@recall/ai-core";
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

function createStarterWorkspace(): Workspace {
  const areaId = createAreaId(Crypto.randomUUID());
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Cell biology",
        color: palette.green,
        objectives: [
          {
            id: createObjectiveId(Crypto.randomUUID()),
            title: "Cell structures",
            description: null,
            prerequisiteIds: [],
          },
          {
            id: createObjectiveId(Crypto.randomUUID()),
            title: "Gene expression",
            description: null,
            prerequisiteIds: [],
          },
        ],
        cards: [
          {
            id: createCardId(Crypto.randomUUID()),
            front: "What is the main role of mitochondria?",
            back: "They produce most of the cell’s usable ATP through cellular respiration.",
            objective: "Cell structures",
            schedule: newSchedule(new Date()),
          },
          {
            id: createCardId(Crypto.randomUUID()),
            front: "Where does transcription happen in a eukaryotic cell?",
            back: "In the nucleus, where DNA is used to make RNA.",
            objective: "Gene expression",
            schedule: newSchedule(new Date()),
          },
          {
            id: createCardId(Crypto.randomUUID()),
            front: "What does the cell membrane regulate?",
            back: "The movement of substances into and out of the cell.",
            objective: "Cell structures",
            schedule: newSchedule(new Date()),
          },
        ],
      },
    ],
  };
}

function dueNow(card: StudyCard, now: number): boolean {
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
    setSyncOwnershipIssue(null);
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
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
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
      const tutorSessionsCleared = Either.isRight(tutorSessions);
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
    return makeNativeTutorApi(apiUrl, async () => {
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
      return Either.isRight(result) ? (result.right.data.session?.access_token ?? null) : null;
    });
  }, []);

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
        setWorkspace(createStarterWorkspace());
        setMessage("Local database is unavailable. Study changes will stay in this session.");
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
        setWorkspace(createStarterWorkspace());
        setMessage("Saved cards could not be read. Existing data was left untouched.");
        setReady(true);
        return;
      }

      if (loaded.right._tag === "Loaded") {
        setWorkspace(loaded.right.workspace);
        setCacheWritable(true);
      } else if (loaded.right._tag === "Empty") {
        const starter = createStarterWorkspace();
        const saved = await Effect.runPromise(Effect.either(saveWorkspace(localStore, starter)));
        setWorkspace(starter);
        setCacheWritable(Either.isRight(saved));
        if (Either.isLeft(saved))
          setMessage("Starter cards are temporary because the database is read-only.");
      } else {
        setWorkspace(createStarterWorkspace());
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
    ? Effect.runSync(Effect.either(toKnowledgeArea(activeArea, true, true)))
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
        return transition.workspace;
      }),
    ).pipe(
      Effect.match({
        onFailure: (failure) => {
          if (failure._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
          setMessage(
            failure._tag === "NativeWorkspacePersistenceFailed"
              ? "Your review is recorded in this session, but local storage could not save it."
              : "That review could not be recorded. Your existing history has been preserved.",
          );
        },
        onSuccess: () => setNow(Date.now()),
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
        const workspaceAndMedia = yield* clearLocalStores.current;
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
      const starter = createStarterWorkspace();
      setWorkspace(starter);
      void Effect.runPromise(Effect.either(saveWorkspace(store, starter))).then((saved) => {
        setActiveAreaId(starter.areas[0]?.id ?? null);
        setCacheWritable(Either.isRight(saved));
        setShowAnswer(false);
        setMessage(
          Either.isRight(saved) ? "Fresh sample cards are ready." : "Fresh cards are temporary.",
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
    return "Your learning areas and reviews are synced.";
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
        : "Import failed. Choose a valid Knowledge Area JSON or media ZIP file smaller than 25 MB.";
    const proposal = imported.right;
    if (!proposal) return "Import canceled.";
    if (format) {
      const accepted = await new Promise<boolean>((resolve) => {
        Alert.alert(
          `Import ${format.toUpperCase()} cards?`,
          `${proposal.area.title}\n${proposal.area.cards.length} cards · ${proposal.area.objectives?.length ?? 0} objectives\n\nA separate area will be added with fresh identities and schedules. Tags and objective labels are preserved. Attachments and review history are not imported; your existing library stays available.`,
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
    return `${proposal.area.title} imported. Its review history and schedule start fresh.`;
  }

  async function exportActiveArea(format?: "csv" | "tsv"): Promise<string> {
    const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
    if (!area) return "There is no learning area to export.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const result = await Effect.runPromise(
      Effect.either(shareKnowledgeArea(area, mediaStore, format)),
    );
    return Either.isRight(result)
      ? `${area.title} is ready to share.`
      : "The learning area could not be exported.";
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
        "The backup will replace learning areas, review history, schedules and local attachments. Its saved cloud account binding is retained.",
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
    const result = await Effect.runPromise(
      Effect.either(shareWorkspaceBackup(workspace, mediaStore)),
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
            ? yield* clearLocalStores.current
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
                return current;
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
              return {
                ...current,
                areas: [...current.areas, imported],
                syncContentHashes: {
                  ...(current.syncContentHashes ?? {}),
                  [imported.id]: contentHash,
                },
              };
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
        message: "Local storage must be writable and cleanup complete before editing.",
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
            : "Changes could not be saved. Your draft remains open; restore local storage before retrying.";
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
    setMediaRevision((revision) => revision + 1);
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

  const authoringPanel = (
    <NativeWorkspaceAuthoringPanel
      workspace={workspace}
      activeAreaId={activeAreaId}
      disabled={authoringDisabledReason !== undefined}
      {...(authoringDisabledReason === undefined
        ? {}
        : { disabledReason: authoringDisabledReason })}
      createId={Crypto.randomUUID}
      onPickAttachment={pickNativeMedia}
      onCommand={applyAuthoringCommand}
    />
  );
  const tutorPanel =
    activePublishingArea && Either.isRight(activePublishingArea) ? (
      <NativeTutorPanel
        key={`${activeArea?.id ?? "no-area"}:${nativeTutorSessionId ?? "new"}`}
        area={activePublishingArea.right}
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
      />
    ) : null;
  return (
    <NativeAppShell
      areas={workspace?.areas ?? []}
      activeAreaId={activeAreaId}
      selectionDisabled={reviewPending}
      onSelectArea={(areaId) => {
        setActiveAreaId(areaId);
        setShowAnswer(false);
        setMediaUris({});
      }}
      today={
        <NativeTodayScreen
          ready={ready}
          workspace={workspace}
          activeAreaId={activeAreaId}
          now={now}
          message={message}
          mediaUris={mediaUris}
          showAnswer={showAnswer}
          reviewPending={reviewPending}
          canReset={store !== null}
          onSelectArea={setActiveAreaId}
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
        <NativePublishingPanel
          key={activeArea?.id ?? "receive-shared-area"}
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
          onFork={addPublishedFork}
        />
      }
      account={
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
      }
    />
  );
}
