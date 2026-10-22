import { useCallback, useMemo, useState } from "react";
import { Effect, Either } from "effect";
import { emptyActivityLibrary } from "@recall/domain";
import {
  studySessionQueue,
  studySessionArea,
  nextStudyArea,
  summarizeStudySubjects,
  recommendLearningActivities,
  retainLibraryDraft,
  renderClozeCard,
  workspaceDuplicateCandidates,
  findCardDuplicates,
} from "@recall/application";
import { toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { retainDraftFile } from "@/lib/library-notes-store";
import { cardDuplicateAcknowledgementKey } from "@/components/knowledge/library/duplicates/CardDuplicateWarnings";
import { summarizeDashboardReviews } from "@/features/dashboard/review/RecallDashboardReviewSummary";
import { snapshotLibraryDraft } from "@/features/dashboard/authoring/drafts/RecallDashboardDraftSnapshot";
import type { LearningArea } from "@/features/workspace/types";
import type { RecallDashboardBaseState } from "./useRecallDashboardBaseState";
import type { RecallDashboardEditorState } from "./useRecallDashboardEditorState";

function activeActivitiesFor(
  activities: typeof emptyActivityLibrary.activities,
  areaId: string,
): typeof emptyActivityLibrary.activities {
  return activities.filter((activity) => activity.areaId === areaId && !activity.archived);
}

function publishingDocument(
  area: LearningArea | undefined,
  activityLibrary: typeof emptyActivityLibrary,
) {
  if (!area) return null;
  return Effect.runSync(
    Effect.either(
      toKnowledgeArea(area, true, true).pipe(
        Effect.map((document) => ({
          ...document,
          activities: activeActivitiesFor(activityLibrary.activities, area.id),
        })),
      ),
    ),
  );
}

export function useRecallDashboardDerivedState(
  model: Pick<
    RecallDashboardBaseState & RecallDashboardEditorState,
    | "demo"
    | "workspace"
    | "libraryNotes"
    | "practiceId"
    | "selectedId"
    | "imageOcclusion"
    | "cardKind"
    | "clozeText"
    | "clozeIndex"
    | "front"
    | "back"
    | "editingCardId"
    | "duplicateAcknowledgement"
    | "addingArea"
    | "areaTitle"
    | "editingAreaId"
    | "areaColor"
    | "areaEditor"
    | "workspaceRef"
    | "addingCard"
    | "cardPresentation"
    | "cardTags"
    | "mediaFile"
    | "removedMediaIds"
    | "cardEditor"
    | "cardObjectiveIds"
    | "updateLibraryNotes"
    | "notesScope"
  >,
) {
  const {
    demo,
    workspace,
    libraryNotes,
    practiceId,
    selectedId,
    imageOcclusion,
    cardKind,
    clozeText,
    clozeIndex,
    front,
    back,
    editingCardId,
    duplicateAcknowledgement,
    addingArea,
    areaTitle,
    editingAreaId,
    areaColor,
    areaEditor,
    workspaceRef,
    addingCard,
    cardPresentation,
    cardTags,
    mediaFile,
    removedMediaIds,
    cardEditor,
    cardObjectiveIds,
    updateLibraryNotes,
    notesScope,
  } = model;
  const [now, setNow] = useState(() => new Date(demo ? "2026-10-03T09:00:00.000Z" : Date.now()));
  const deepPracticeRecommendations = workspace.areas
    .flatMap((item) =>
      recommendLearningActivities(
        libraryNotes.notes.activityLibrary ?? emptyActivityLibrary,
        item.id,
        now.getTime(),
      ),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority || left.activity.id.localeCompare(right.activity.id, "en"),
    )
    .slice(0, 3);
  const area =
    practiceId === "all"
      ? (nextStudyArea(workspace, now.getTime()) ?? workspace.areas[0])
      : practiceId
        ? studySessionArea(workspace, practiceId, now.getTime())
        : (workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0]);
  const publishingAreaDocument = useMemo(
    () => publishingDocument(area, libraryNotes.notes.activityLibrary ?? emptyActivityLibrary),
    [area, libraryNotes.notes.activityLibrary],
  );
  const tutorAreaDocument = publishingAreaDocument;
  const clozePreview = useMemo(
    () =>
      cardKind === "cloze"
        ? Effect.runSync(Effect.either(renderClozeCard(clozeText, Number(clozeIndex))))
        : null,
    [cardKind, clozeText, clozeIndex],
  );
  const duplicateCandidates = useMemo(() => workspaceDuplicateCandidates(workspace), [workspace]);
  const duplicateDraft = {
    front: cardKind === "cloze" ? clozeText : front,
    back,
    ...(cardKind === "cloze" && clozePreview && Either.isRight(clozePreview)
      ? { cloze: { text: clozeText, deletionIndex: Number(clozeIndex) } }
      : {}),
  };
  const duplicateKey = cardDuplicateAcknowledgementKey(
    duplicateDraft,
    duplicateCandidates,
    editingCardId ?? undefined,
  );
  const duplicateMatches = findCardDuplicates(
    duplicateDraft,
    duplicateCandidates,
    editingCardId ? { excludeCardId: editingCardId } : {},
  );
  const duplicatesAccepted =
    duplicateMatches.length === 0 || duplicateAcknowledgement === duplicateKey;
  const lineageAreaDocument = useMemo(
    () => (area ? Effect.runSync(Effect.either(toKnowledgeArea(area, false, true))) : null),
    [area],
  );
  const snapshotOpenLibraryDraft = useCallback(
    () =>
      snapshotLibraryDraft({
        addingArea,
        areaTitle,
        editingAreaId,
        areaColor,
        areaEditorId: areaEditor.current.id,
        areaBaseline: areaEditor.current.baseline,
        areas: workspaceRef.current.areas,
        addingCard,
        area,
        editingCardId,
        front,
        back,
        clozeText,
        cardPresentation,
        cardTags,
        mediaFilePresent: Boolean(mediaFile),
        removedMediaIds,
        sourceCard: cardEditor.current.sourceCard,
        imageOcclusion,
        cardKind,
        clozeIndex,
        cardObjectiveIds,
        cardBaseline: cardEditor.current.baseline,
      }),
    [
      addingArea,
      areaTitle,
      editingAreaId,
      areaColor,
      addingCard,
      area,
      front,
      back,
      clozeText,
      cardPresentation,
      cardTags,
      mediaFile,
      removedMediaIds,
      editingCardId,
      imageOcclusion,
      cardKind,
      clozeIndex,
      cardObjectiveIds,
      areaEditor,
      cardEditor,
      workspaceRef,
    ],
  );
  const retainOpenDraft = useCallback(() => {
    const draft = snapshotOpenLibraryDraft();
    if (!draft) return;
    updateLibraryNotes((notes) => retainLibraryDraft(notes, draft));
    if (draft.kind === "card") retainDraftFile(notesScope, draft.key, mediaFile);
  }, [snapshotOpenLibraryDraft, updateLibraryNotes, notesScope, mediaFile]);
  const allCards = workspace.areas.flatMap((item) => item.cards);
  const dueCount = summarizeStudySubjects(workspace, now.getTime()).reduce(
    (total, row) => total + row.due,
    0,
  );
  const queue = area
    ? studySessionQueue(workspace, practiceId ?? "", area, now.getTime())
    : undefined;
  const card = queue?.cards[0];
  const reviewSummary = useMemo(
    () => summarizeDashboardReviews(workspace, area, now),
    [workspace, area, now],
  );
  const {
    practice,
    studiedToday,
    totalReviews,
    objectiveGaps,
    reviewHistory,
    retainedCards,
    deletedRetainedAreas,
    retainedPendingReviews,
  } = reviewSummary;
  return {
    now,
    setNow,
    deepPracticeRecommendations,
    area,
    publishingAreaDocument,
    tutorAreaDocument,
    clozePreview,
    duplicateCandidates,
    duplicateDraft,
    duplicateKey,
    duplicateMatches,
    duplicatesAccepted,
    lineageAreaDocument,
    snapshotOpenLibraryDraft,
    retainOpenDraft,
    allCards,
    dueCount,
    queue,
    card,
    reviewSummary,
    practice,
    studiedToday,
    totalReviews,
    objectiveGaps,
    reviewHistory,
    retainedCards,
    deletedRetainedAreas,
    retainedPendingReviews,
  } as const;
}
export type RecallDashboardDerivedState = ReturnType<typeof useRecallDashboardDerivedState>;
