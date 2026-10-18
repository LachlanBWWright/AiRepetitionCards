import { emptyActivityLibrary } from "@recall/domain";
import { getDeepPracticeRecommendations } from "./review/app-practice-recommendations";
import { useAppBaseState, type AppBaseState } from "./state/useAppBaseState";
import { useAppServices, type AppServices } from "./state/useAppServices";
import { createAppWorkspaceActions } from "./actions/AppWorkspaceActions";
import { createAppReviewActions } from "./review/AppReviewActions";
import { createAppAnkiActions } from "./actions/AppAnkiActions";
import { createAppSyncActions } from "./actions/AppSyncActions";
import { createAppInterchangeActions } from "./actions/AppInterchangeActions";
import { createAppAccountActions } from "./actions/AppAccountActions";
import { createAppForkActions } from "./actions/AppForkActions";
import { createAppTutorActions } from "./actions/AppTutorActions";
import { createAppAuthoringActions } from "./actions/AppAuthoringActions";
import { createAppNavigationActions } from "./actions/AppNavigationActions";
import { createAppDeckUpdateActions } from "./actions/AppDeckUpdateActions";
import { useAppActivityAndAccountEffects } from "./state/useAppActivityAndAccountEffects";
import { useAppStorageEffects } from "./state/useAppStorageEffects";
export type AppCoreState = AppBaseState &
  AppServices & { readonly authoringDisabledReason: string | undefined };
export function useAppController() {
  const base = useAppBaseState();
  const services = useAppServices(base);
  const state = { ...base, ...services };
  const {
    workspaceLifetime,
    ready,
    workspace,
    store,
    cacheWritable,
    reviewPending,
    libraryNotes,
    now,
  } = state;
  const authoringDisabledReason = workspaceLifetime.isBlocked()
    ? "Local cleanup is pending. Finish resetting this device before editing."
    : !ready || !workspace
      ? "Your local library is loading."
      : !store || !cacheWritable
        ? "Local storage is unavailable or read-only. Existing content remains available."
        : reviewPending
          ? "Wait for the pending review to save before editing."
          : undefined;
  const deepPracticeRecommendations = getDeepPracticeRecommendations(
    workspace,
    libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
    now,
  );
  const core = { ...state, authoringDisabledReason };
  const workspaceActions = createAppWorkspaceActions({ ...core });
  const reviewActions = createAppReviewActions({ ...core, ...workspaceActions });
  const ankiActions = createAppAnkiActions({ ...core, ...workspaceActions });
  const syncActions = createAppSyncActions({ ...core, ...workspaceActions });
  const interchangeActions = createAppInterchangeActions({ ...core, ...workspaceActions });
  const accountActions = createAppAccountActions({ ...core, ...workspaceActions });
  const forkActions = createAppForkActions({ ...core, ...workspaceActions });
  const tutorActions = createAppTutorActions({ ...core });
  const authoringActions = createAppAuthoringActions({ ...core, ...workspaceActions });
  const navigationActions = createAppNavigationActions({ ...core, ...interchangeActions });
  const deckUpdateActions = createAppDeckUpdateActions({ ...core, ...workspaceActions });
  const model = {
    ...core,
    ...workspaceActions,
    ...reviewActions,
    ...ankiActions,
    ...syncActions,
    ...interchangeActions,
    ...accountActions,
    ...forkActions,
    ...tutorActions,
    ...authoringActions,
    ...navigationActions,
    ...deckUpdateActions,
    authoringDisabledReason,
    deepPracticeRecommendations,
  } as const;
  useAppActivityAndAccountEffects(model);
  useAppStorageEffects(model);
  return model;
}
export type AppModel = ReturnType<typeof useAppController>;
