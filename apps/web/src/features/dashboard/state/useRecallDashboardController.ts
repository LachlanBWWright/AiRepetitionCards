import { useReviewTiming } from "@recall/react";
import { useEffect, useCallback } from "react";
import type { ReviewRating } from "@recall/scheduler";
import type { RecallDashboardProps } from "../RecallDashboardProps";
import {
  useRecallDashboardBaseState,
  type RecallDashboardBaseState,
} from "./useRecallDashboardBaseState";
import {
  useRecallDashboardEditorState,
  type RecallDashboardEditorState,
} from "./useRecallDashboardEditorState";
import {
  useRecallDashboardDerivedState,
  type RecallDashboardDerivedState,
} from "./useRecallDashboardDerivedState";
import { createRecallDashboardContentActions } from "../authoring/actions/RecallDashboardContentActions";
import { createRecallDashboardNavigationActions } from "../navigation/RecallDashboardNavigationActions";
import { createRecallDashboardDraftActions } from "../authoring/actions/RecallDashboardDraftActions";
import { createRecallDashboardBulkActions } from "../authoring/actions/RecallDashboardBulkActions";
import { createRecallDashboardAreaActions } from "../authoring/actions/RecallDashboardAreaActions";
import { createRecallDashboardEditorCloseActions } from "../authoring/actions/RecallDashboardEditorCloseActions";
import { createRecallDashboardDeletionActions } from "../authoring/actions/RecallDashboardDeletionActions";
import { createRecallDashboardCardEditingActions } from "../authoring/actions/RecallDashboardCardEditingActions";
import { createRecallDashboardCardSaveActions } from "../authoring/actions/RecallDashboardCardSaveActions";
import { createRecallDashboardStorageActions } from "../storage/RecallDashboardStorageActions";
import { createRecallDashboardReviewActions } from "../review/RecallDashboardReviewActions";
import { useRecallDashboardWorkspaceEffects } from "./useRecallDashboardWorkspaceEffects";
import { useRecallDashboardDraftEffects } from "./useRecallDashboardDraftEffects";
export type RecallDashboardCore = RecallDashboardBaseState &
  RecallDashboardEditorState &
  RecallDashboardDerivedState;
export function useRecallDashboardController(props: RecallDashboardProps) {
  const base = useRecallDashboardBaseState(props);
  const editor = useRecallDashboardEditorState(base);
  const { setSelectedIdState } = editor;
  const { setLibraryDeckOpen } = base;
  useEffect(() => {
    if (!props.routeView) return;
    if (props.initialAreaId && props.initialAreaId !== "all")
      setSelectedIdState(props.initialAreaId);
    setLibraryDeckOpen(Boolean(props.initialAreaId || props.initialActivityId));
  }, [
    props.routeView,
    props.initialAreaId,
    props.initialActivityId,
    setSelectedIdState,
    setLibraryDeckOpen,
  ]);
  const derived = useRecallDashboardDerivedState({ ...base, ...editor });
  const core = { ...base, ...editor, ...derived };
  const { setShowAnswer } = editor;
  const hideReviewAnswer = useCallback(() => {
    setShowAnswer(false);
  }, [setShowAnswer]);
  const getReviewElapsedMs = useReviewTiming(derived.card?.id, hideReviewAnswer, Date.now);
  const contentActions = createRecallDashboardContentActions({ ...core });
  const editorCloseActions = createRecallDashboardEditorCloseActions({ ...core });
  const draftActions = createRecallDashboardDraftActions({ ...core, ...editorCloseActions });
  const bulkActions = createRecallDashboardBulkActions({ ...core, ...editorCloseActions });
  const areaActions = createRecallDashboardAreaActions({
    ...core,
    ...bulkActions,
    ...editorCloseActions,
  });
  const deletionActions = createRecallDashboardDeletionActions({ ...core, ...bulkActions });
  const cardEditingActions = createRecallDashboardCardEditingActions({
    ...core,
    ...areaActions,
    ...editorCloseActions,
  });
  const navigationActions = createRecallDashboardNavigationActions({
    ...core,
    ...editorCloseActions,
    ...cardEditingActions,
  });
  const cardSaveActions = createRecallDashboardCardSaveActions({
    ...core,
    ...editorCloseActions,
    ...cardEditingActions,
  });
  const storageActions = createRecallDashboardStorageActions({ ...core, ...contentActions });
  const reviewActions = createRecallDashboardReviewActions({ ...core });
  const model = {
    ...core,
    ...contentActions,
    ...editorCloseActions,
    ...draftActions,
    ...bulkActions,
    ...areaActions,
    ...deletionActions,
    ...cardEditingActions,
    ...navigationActions,
    ...cardSaveActions,
    ...storageActions,
    ...reviewActions,
    review: (rating: ReviewRating) => reviewActions.review(rating, getReviewElapsedMs()),
  } as const;
  useRecallDashboardWorkspaceEffects(model);
  useRecallDashboardDraftEffects(model);
  return model;
}
export type RecallDashboardModel = ReturnType<typeof useRecallDashboardController>;
