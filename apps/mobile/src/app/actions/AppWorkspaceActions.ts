import { clearNativeLibraryNotes } from "../../storage/workspace/native-library-notes";
import { Effect, Either } from "effect";
import { saveWorkspace, saveWorkspaceWithMedia } from "@recall/application";
import type { WorkspaceMediaCommitFailure } from "@recall/application";
import type { Workspace } from "@recall/domain";
import { createAreaId } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { clearNativePendingOperations } from "../../storage/workspace/native-operation-store";
import { clearNativeKnowledgeNotebooks } from "../../storage/ai/native-knowledge-notebook-store";
import { clearNativeDailyReminders } from "../../storage/workspace/native-daily-reminders";
import { clearNativeLocalBudget } from "../../storage/ai/native-local-ai-budget";
import { clearNativeReleaseDrafts } from "../../storage/publishing/native-release-draft-store";
import { clearNativeChatGPTTutorState } from "../../storage/ai/native-chatgpt-tutor-store";
import { clearNativeTutorSessionIds } from "../../storage/ai/native-tutor-session";
import type { AppBaseState } from "../state/useAppBaseState";

type NativeWorkspaceCommitFailure =
  | { readonly _tag: "NativeWorkspaceUnavailable"; readonly persisted?: boolean }
  | { readonly _tag: "NativeWorkspacePersistenceFailed"; readonly mediaRollback?: boolean };
type WorkspacePersistenceError =
  | Effect.Effect.Error<ReturnType<typeof saveWorkspace>>
  | WorkspaceMediaCommitFailure
  | NativeWorkspaceCommitFailure;
function mapWorkspacePersistenceError(
  error: WorkspacePersistenceError,
  unavailable: boolean,
): NativeWorkspaceCommitFailure {
  if (unavailable) return { _tag: "NativeWorkspaceUnavailable" };
  return {
    _tag: "NativeWorkspacePersistenceFailed",
    mediaRollback:
      error._tag === "WorkspaceMediaCommitFailure" && error.reason === "media-rollback",
  };
}

export function createAppWorkspaceActions(
  model: Pick<
    AppBaseState,
    | "setStudySession"
    | "setSyncOwnershipIssue"
    | "setSearchOpen"
    | "setSearchTarget"
    | "setOperationGeneration"
    | "workspaceLifetime"
    | "workspaceChangeLane"
    | "workspaceRef"
    | "setWorkspace"
    | "store"
    | "cacheWritable"
    | "mediaStore"
    | "pendingCleanupTargets"
    | "nativeTutorSessionIds"
    | "dailyReminders"
    | "setNativeTutorSessionIds"
    | "setChatGPTSession"
  >,
) {
  const {
    setStudySession,
    setSyncOwnershipIssue,
    setSearchOpen,
    setSearchTarget,
    setOperationGeneration,
    workspaceLifetime,
    workspaceChangeLane,
    workspaceRef,
    setWorkspace,
    store,
    cacheWritable,
    mediaStore,
    pendingCleanupTargets,
    nativeTutorSessionIds,
    dailyReminders,
    setNativeTutorSessionIds,
    setChatGPTSession,
  } = model;
  function invalidateWorkspaceOperations() {
    setStudySession(null);
    setSyncOwnershipIssue(null);
    setSearchOpen(false);
    setSearchTarget(null);
    setOperationGeneration(workspaceLifetime.invalidate());
  }
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
          const classifyPersistenceError = (error: WorkspacePersistenceError) =>
            mapWorkspacePersistenceError(
              error,
              workspaceLifetime.generation() !== expectedGeneration ||
                workspaceLifetime.isBlocked(),
            );
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
          yield* persistence.pipe(Effect.mapError(classifyPersistenceError));
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
      const chatGPTSessions = yield* Effect.either(clearNativeChatGPTTutorState);
      const pendingOperationsCleared = Either.isRight(pendingOperations);
      const libraryDrafts = yield* Effect.either(clearNativeLibraryNotes);
      const releaseDrafts = yield* Effect.either(clearNativeReleaseDrafts);
      const notebooks = yield* Effect.either(clearNativeKnowledgeNotebooks(null));
      const reminders = yield* Effect.either(clearNativeDailyReminders);
      if (Either.isRight(reminders)) dailyReminders.markCleared();
      const budgets = yield* Effect.either(clearNativeLocalBudget);
      const tutorSessionsCleared =
        Either.isRight(tutorSessions) &&
        Either.isRight(chatGPTSessions) &&
        Either.isRight(notebooks) &&
        Either.isRight(libraryDrafts) &&
        Either.isRight(releaseDrafts) &&
        Either.isRight(reminders) &&
        Either.isRight(budgets);
      if (pendingOperationsCleared && tutorSessionsCleared) {
        pendingCleanupTargets.current = { areaIds: [], forkVersionIds: [] };
        setNativeTutorSessionIds({});
        setChatGPTSession(null);
      }
      return { pendingOperationsCleared, tutorSessionsCleared };
    });
  }
  return {
    invalidateWorkspaceOperations,
    commitWorkspaceChange,
    captureCleanupTargets,
    clearAuxiliaryNativeData,
  } as const;
}
