import { withNativeOperationStoreLane } from "../../storage/workspace/native-operation-store";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { localStudyDay, recordReview, saveWorkspace } from "@recall/application";
import { type ReviewRating } from "@recall/scheduler";
import type { ReviewEvent } from "@recall/domain";
import { createEmptyWorkspace } from "../state/workspace-utils";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "../actions/AppWorkspaceActions";
export function createAppReviewActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "getReviewElapsedMs"
    | "reviewInProgress"
    | "workspace"
    | "activeArea"
    | "card"
    | "setReviewPending"
    | "setShowAnswer"
    | "commitWorkspaceChange"
    | "setCacheWritable"
    | "workspaceRef"
    | "setStudySession"
    | "setMessage"
    | "setNow"
    | "store"
    | "mediaStore"
    | "captureCleanupTargets"
    | "invalidateWorkspaceOperations"
    | "workspaceLifetime"
    | "syncConflictGeneration"
    | "setSyncConflictWorkspace"
    | "clearLocalStores"
    | "clearAuxiliaryNativeData"
    | "setWorkspace"
    | "setActiveAreaId"
  >,
) {
  const {
    reviewInProgress,
    getReviewElapsedMs,
    workspace,
    activeArea,
    card,
    setReviewPending,
    setShowAnswer,
    commitWorkspaceChange,
    setCacheWritable,
    workspaceRef,
    setStudySession,
    setMessage,
    setNow,
    store,
    mediaStore,
    captureCleanupTargets,
    invalidateWorkspaceOperations,
    workspaceLifetime,
    syncConflictGeneration,
    setSyncConflictWorkspace,
    clearLocalStores,
    clearAuxiliaryNativeData,
    setWorkspace,
    setActiveAreaId,
  } = model;
  async function review(rating: ReviewRating) {
    if (reviewInProgress.current || !workspace || !activeArea || !card) return;
    reviewInProgress.current = true;
    setReviewPending(true);
    setShowAnswer(false);
    const areaId = activeArea.id;
    const cardId = card.id;
    const ratedAt = new Date().toISOString();
    const elapsedMs = getReviewElapsedMs();
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
          elapsedMs,
          studyDay: localStudyDay(Date.parse(ratedAt)),
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
  return { review, resetLocalWorkspace } as const;
}
