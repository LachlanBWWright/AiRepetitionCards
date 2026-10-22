import type { StoredMediaAsset } from "@recall/local-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { readRef } from "@/lib/read-ref";
import { Effect, Either } from "effect";
import { createAssessmentId, createObjectiveId, type CardVersion } from "@recall/domain";
import {
  applyWorkspaceAuthoringCommand,
  refinementCardContent,
  type WorkspaceAuthoringCommand,
  parseTagInput,
  saveWorkspace,
  saveWorkspaceWithMedia,
  cardVersionRestoresAsCopy,
} from "@recall/application";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { type CardRefinementResult } from "@recall/ai-core";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardEditorCloseActions } from "./RecallDashboardEditorCloseActions";
function persistAuthoringWorkspace(
  workspace: import("@recall/domain").Workspace,
  assets: readonly StoredMediaAsset[],
) {
  return assets.length
    ? saveWorkspaceWithMedia(browserWorkspaceStore, browserMediaStore, workspace, assets)
    : saveWorkspace(browserWorkspaceStore, workspace);
}
export function createRecallDashboardBulkActions(
  model: Pick<
    RecallDashboardCore & ReturnType<typeof createRecallDashboardEditorCloseActions>,
    | "libraryMutationPending"
    | "cardSavePending"
    | "reviewSaving"
    | "reviewSaveFailed"
    | "setLibraryMutation"
    | "setImportNotice"
    | "setNow"
    | "enqueueWorkspaceCommit"
    | "cardEditorMounted"
    | "pendingReviewRef"
    | "demo"
    | "ready"
    | "cacheWritable"
    | "workspaceRef"
    | "setWorkspace"
    | "setCardSaving"
    | "setSelectedId"
    | "setShowAnswer"
    | "area"
    | "mediaFile"
    | "cardEditor"
    | "cardTags"
    | "setCardEditorError"
    | "cardObjectiveIds"
    | "removedMediaIds"
    | "cardKind"
    | "setFront"
    | "setBack"
    | "setCardKind"
    | "setClozeText"
    | "setClozeIndex"
    | "setCardObjectiveIds"
    | "editingCardId"
    | "closeCardEditor"
  >,
) {
  const {
    libraryMutationPending,
    cardSavePending,
    reviewSaving,
    reviewSaveFailed,
    setLibraryMutation,
    setImportNotice,
    setNow,
    enqueueWorkspaceCommit,
    cardEditorMounted,
    pendingReviewRef,
    demo,
    ready,
    cacheWritable,
    workspaceRef,
    setWorkspace,
    setCardSaving,
    setSelectedId,
    setShowAnswer,
    area,
    mediaFile,
    cardEditor,
    cardTags,
    setCardEditorError,
    cardObjectiveIds,
    removedMediaIds,
    cardKind,
    setFront,
    setBack,
    setCardKind,
    setClozeText,
    setClozeIndex,
    setCardObjectiveIds,
    editingCardId,
    closeCardEditor,
  } = model;
  async function applyBulkCards(
    command: WorkspaceAuthoringCommand,
    expectedBaseline: string | undefined,
  ): Promise<{ readonly ok: boolean; readonly message?: string }> {
    if (
      libraryMutationPending.current ||
      cardSavePending.current ||
      reviewSaving ||
      reviewSaveFailed
    )
      return { ok: false, message: "Wait for the current save to finish." };
    libraryMutationPending.current = true;
    setLibraryMutation("area-save");
    const saved = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(command, expectedBaseline)),
    );
    libraryMutationPending.current = false;
    setLibraryMutation(null);
    if (Either.isLeft(saved)) {
      setImportNotice(saved.left.message);
      return { ok: false, message: saved.left.message };
    }
    setImportNotice("Selected cards saved. Review history is preserved.");
    setNow(new Date());
    return { ok: true };
  }
  const saveAuthoringCommand = (
    command: WorkspaceAuthoringCommand,
    expectedBaseline?: string,
    assets: readonly StoredMediaAsset[] = [],
  ) =>
    enqueueWorkspaceCommit(
      Effect.gen(function* () {
        for (;;) {
          if (
            !cardEditorMounted.current ||
            localWritesBlocked() ||
            localSnapshotStale() ||
            readRef(pendingReviewRef)
          )
            return yield* Effect.fail({ _tag: "SettingsCommitPaused" } as const);
          if (!demo && (!ready || !cacheWritable))
            return yield* Effect.fail({ _tag: "SettingsStorageUnavailable" } as const);
          const current = workspaceRef.current;
          const prepared = yield* applyWorkspaceAuthoringCommand(
            current,
            command,
            new Date(),
            expectedBaseline,
          );
          if (!demo) yield* persistAuthoringWorkspace(prepared.workspace, assets);
          if (localWritesBlocked() || localSnapshotStale() || readRef(pendingReviewRef))
            return yield* Effect.fail({ _tag: "SettingsCommitPaused" } as const);
          if (workspaceRef.current !== current) continue;
          setWorkspace(prepared.workspace);
          return prepared.workspace;
        }
      }),
    ).pipe(
      Effect.mapError((error) => {
        if (error._tag === "WorkspaceAuthoringFailure")
          return {
            reason:
              error.reason === "stale-content"
                ? ("stale-content" as const)
                : ("unavailable" as const),
            message:
              error.reason === "stale-content"
                ? "This content changed before your change could be saved. Your draft or deletion request is preserved. Review the latest content before retrying."
                : error.message,
          };
        if (error._tag === "SettingsCommitPaused" || error._tag === "WorkspaceCommitPaused")
          return {
            reason: "paused" as const,
            message:
              "Local changes are paused. Your draft is preserved; restore storage or save the pending review before retrying.",
          };
        return {
          reason: "storage" as const,
          message:
            "Save not confirmed. The draft or selection is still here. Check your connection, then retry saving.",
        };
      }),
    );
  async function restoreVersion(version: CardVersion, expectedBaseline: string | undefined) {
    if (cardSavePending.current || libraryMutationPending.current) return false;
    cardSavePending.current = true;
    setCardSaving(true);
    const current = workspaceRef.current;
    const result = await Effect.runPromise(
      Effect.either(
        saveAuthoringCommand(
          {
            kind: "restore-card",
            areaId: version.areaId,
            cardId: version.cardId,
            versionId: version.id,
          },
          expectedBaseline,
        ),
      ),
    );
    cardSavePending.current = false;
    if (!readRef(cardEditorMounted)) return false;
    setCardSaving(false);
    if (Either.isLeft(result)) {
      setImportNotice(result.left.message);
      return false;
    }
    const targetArea =
      result.right.areas.find((item) => item.id === version.areaId) ??
      result.right.areas.find((item) => !current.areas.some((previous) => previous.id === item.id));
    if (targetArea) setSelectedId(targetArea.id);
    setShowAnswer(false);
    setImportNotice(
      cardVersionRestoresAsCopy(current, version.areaId, version.cardId)
        ? "Card restored as a new copy. Previous reviews are preserved."
        : "Card restored.",
    );
    return true;
  }
  async function applyCardRefinement(
    result: CardRefinementResult,
    mode: "wording" | "replace",
  ): Promise<boolean> {
    if (
      !area ||
      cardSavePending.current ||
      mediaFile ||
      localWritesBlocked() ||
      localSnapshotStale()
    )
      return false;
    const generation = cardEditor.current.generation;
    const tags = parseTagInput(cardTags);
    if (Either.isLeft(tags)) {
      setCardEditorError(tags.left.message);
      return false;
    }
    const metadata = {
      tags: tags.right,
      objectiveIds: cardObjectiveIds.map(createObjectiveId),
      media: (cardEditor.current.sourceCard?.media ?? []).filter(
        (item) => !removedMediaIds.includes(item.id),
      ),
    };
    const converted = Effect.runSync(
      Effect.either(Effect.all(result.cards.map((card) => refinementCardContent(card, metadata)))),
    );
    if (Either.isLeft(converted)) {
      setCardEditorError(converted.left.message);
      return false;
    }
    const first = converted.right[0];
    if (!first) return false;
    if (mode === "wording") {
      if (
        result.cards.length !== 1 ||
        result.cards[0]?.meaningChanged !== false ||
        first.kind !== cardKind
      )
        return false;
      setFront(first.front);
      setBack(first.back);
      setCardKind(first.kind);
      setClozeText(first.cloze?.text ?? "");
      setClozeIndex(String(first.cloze?.deletionIndex ?? 1));
      setCardObjectiveIds([...first.objectiveIds]);
      setCardEditorError(
        "Refinement applied to your draft. Save the card to keep this wording change.",
      );
      return true;
    }
    const cards = converted.right.map((content) => ({
      cardId: createAssessmentId(crypto.randomUUID()),
      content,
    }));
    const command: WorkspaceAuthoringCommand = editingCardId
      ? { kind: "replace-card", areaId: area.id, cardId: createAssessmentId(editingCardId), cards }
      : { kind: "create-cards", areaId: area.id, cards };
    const expectedBaseline = editingCardId ? cardEditor.current.baseline : undefined;
    cardSavePending.current = true;
    setCardSaving(true);
    setCardEditorError(null);
    const saved = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(command, expectedBaseline)),
    );
    cardSavePending.current = false;
    if (cardEditor.current.generation !== generation || !cardEditorMounted.current) return false;
    setCardSaving(false);
    if (Either.isLeft(saved)) {
      setCardEditorError(saved.left.message);
      return false;
    }
    closeCardEditor();
    setShowAnswer(false);
    return true;
  }
  return { applyBulkCards, saveAuthoringCommand, restoreVersion, applyCardRefinement } as const;
}
