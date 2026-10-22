import { readRef } from "@/lib/read-ref";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { MediaReferenceSchema, type MediaReference } from "@recall/domain";
import {
  applyWorkspaceAuthoringCommand,
  parseTagInput,
  isSupportedMediaContent,
  saveWorkspaceWithMedia,
  discardLibraryDraft,
  workspaceDuplicateCandidates,
  findCardDuplicates,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { cardDuplicateAcknowledgementKey } from "@/components/knowledge/library/duplicates/CardDuplicateWarnings";
import { staleCardDraftMessage } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardEditorCloseActions } from "./RecallDashboardEditorCloseActions";
import type { createRecallDashboardCardEditingActions } from "./RecallDashboardCardEditingActions";
export function createRecallDashboardCardSaveActions(
  model: Pick<
    RecallDashboardCore &
      ReturnType<typeof createRecallDashboardEditorCloseActions> &
      ReturnType<typeof createRecallDashboardCardEditingActions>,
    | "saveAnother"
    | "area"
    | "cardSavePending"
    | "duplicatesAccepted"
    | "setCardEditorError"
    | "cardPresentation"
    | "cardTags"
    | "demo"
    | "ready"
    | "cacheWritable"
    | "cardEditor"
    | "editingCardId"
    | "cardEditorMounted"
    | "removedMediaIds"
    | "imageOcclusion"
    | "cardKind"
    | "front"
    | "back"
    | "clozeText"
    | "clozeIndex"
    | "cardObjectiveIds"
    | "setCardDraftStale"
    | "workspaceRef"
    | "mediaFile"
    | "setCardSaving"
    | "enqueueWorkspaceSave"
    | "pendingReviewRef"
    | "duplicateDraft"
    | "duplicateAcknowledgement"
    | "setWorkspace"
    | "libraryNotes"
    | "setNow"
    | "closeCardEditor"
    | "addCard"
    | "setCardKind"
    | "setImportNotice"
    | "setShowAnswer"
  >,
) {
  const {
    saveAnother,
    area,
    cardSavePending,
    duplicatesAccepted,
    setCardEditorError,
    cardPresentation,
    cardTags,
    demo,
    ready,
    cacheWritable,
    cardEditor,
    editingCardId,
    cardEditorMounted,
    removedMediaIds,
    imageOcclusion,
    cardKind,
    front,
    back,
    clozeText,
    clozeIndex,
    cardObjectiveIds,
    setCardDraftStale,
    workspaceRef,
    mediaFile,
    setCardSaving,
    enqueueWorkspaceSave,
    pendingReviewRef,
    duplicateDraft,
    duplicateAcknowledgement,
    setWorkspace,
    libraryNotes,
    setNow,
    closeCardEditor,
    addCard,
    setCardKind,
    setImportNotice,
    setShowAnswer,
  } = model;
  async function createCard(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    saveAnother.current =
      event.nativeEvent instanceof SubmitEvent &&
      event.nativeEvent.submitter instanceof HTMLElement &&
      event.nativeEvent.submitter.dataset.saveAnother === "true";
    if (!area || cardSavePending.current) return;
    if (!duplicatesAccepted) {
      setCardEditorError("Review the matching cards and choose Keep both before saving.");
      return;
    }
    const parsedTags = parseTagInput(cardTags);
    if (Either.isLeft(parsedTags)) {
      setCardEditorError(parsedTags.left.message);
      return;
    }
    if (!demo && (!ready || !cacheWritable)) {
      setCardEditorError("Restore local storage before saving this card. Your draft is preserved.");
      return;
    }
    const editorGeneration = cardEditor.current.generation;
    const expectedBaseline = editingCardId ? cardEditor.current.baseline : undefined;
    const isCurrent = () =>
      cardEditorMounted.current && cardEditor.current.generation === editorGeneration;
    const media = (cardEditor.current.sourceCard?.media ?? []).filter(
      (reference) => !removedMediaIds.includes(reference.id),
    );
    const cardId = editingCardId ?? crypto.randomUUID();
    const createdAt = new Date();
    const command = (references: readonly MediaReference[]) => ({
      kind: editingCardId ? ("update-card" as const) : ("create-card" as const),
      areaId: area.id,
      cardId,
      content: {
        imageOcclusion,
        removeImageOcclusion:
          !imageOcclusion && Boolean(cardEditor.current.sourceCard?.imageOcclusion),
        kind: cardKind,
        front,
        back,
        cloze:
          cardKind === "cloze" ? { text: clozeText, deletionIndex: Number(clozeIndex) } : undefined,
        objectiveIds: cardObjectiveIds,
        presentation: cardPresentation,
        tags: parsedTags.right,
        media: references,
      },
    });
    const reject = (message: string, staleDraft = false) => {
      if (!isCurrent()) return;
      setCardEditorError(staleDraft ? staleCardDraftMessage : message);
      setCardDraftStale(staleDraft);
    };
    const preflight = Effect.runSync(
      Effect.either(
        applyWorkspaceAuthoringCommand(
          workspaceRef.current,
          command(media),
          createdAt,
          expectedBaseline,
        ),
      ),
    );
    if (Either.isLeft(preflight)) {
      reject(preflight.left.message, preflight.left.reason === "stale-content");
      return;
    }
    if (mediaFile && (media.length >= 20 || mediaFile.size < 1 || mediaFile.size > 20_000_000)) {
      reject(
        media.length >= 20
          ? "A card can have up to 20 attachments. Remove one before adding another."
          : "Media must be smaller than 20 MB.",
      );
      return;
    }
    cardSavePending.current = true;
    setCardSaving(true);
    setCardEditorError(null);
    const assets: StoredMediaAsset[] = [];
    if (mediaFile) {
      const mimeType = mediaFile.type;
      const read = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => mediaFile.arrayBuffer(),
            catch: () => ({ _tag: "MediaAttachmentFailure" }) as const,
          }).pipe(
            Effect.flatMap((buffer) => {
              const bytes = new Uint8Array(buffer);
              const id = Array.from(sha256(bytes), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join("");
              const decoded = Schema.decodeUnknownEither(MediaReferenceSchema)({
                id,
                mimeType,
                byteLength: bytes.byteLength,
              });
              return Either.isLeft(decoded) ||
                !isSupportedMediaContent(bytes, decoded.right.mimeType)
                ? Effect.fail({ _tag: "MediaAttachmentFailure" } as const)
                : Effect.succeed({ reference: decoded.right, bytes });
            }),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(read)) {
        reject("Choose a supported image or audio file. Your draft is preserved.");
        cardSavePending.current = false;
        setCardSaving(false);
        return;
      }
      if (!media.some((reference) => reference.id === read.right.reference.id)) {
        media.push(read.right.reference);
      }
      assets.push(read.right);
    }
    const accepted = await enqueueWorkspaceSave(async () => {
      for (;;) {
        if (!isCurrent()) return false;
        if (localWritesBlocked() || localSnapshotStale() || pendingReviewRef.current) {
          reject(
            "Local changes are paused. Your draft is preserved; restore storage or save the pending review before retrying.",
          );
          return false;
        }
        const current = workspaceRef.current;
        const latestCandidates = workspaceDuplicateCandidates(current);
        if (
          findCardDuplicates(
            duplicateDraft,
            latestCandidates,
            editingCardId ? { excludeCardId: editingCardId } : {},
          ).length > 0 &&
          duplicateAcknowledgement !==
            cardDuplicateAcknowledgementKey(
              duplicateDraft,
              latestCandidates,
              editingCardId ?? undefined,
            )
        ) {
          reject("The matching cards changed. Review them and choose Keep both before saving.");
          return false;
        }
        const prepared = Effect.runSync(
          Effect.either(
            applyWorkspaceAuthoringCommand(current, command(media), createdAt, expectedBaseline),
          ),
        );
        if (Either.isLeft(prepared)) {
          reject(prepared.left.message, prepared.left.reason === "stale-content");
          return false;
        }
        if (!demo) {
          const saved = await Effect.runPromise(
            Effect.either(
              saveWorkspaceWithMedia(
                browserWorkspaceStore,
                browserMediaStore,
                prepared.right.workspace,
                assets,
              ),
            ),
          );
          if (!isCurrent()) return false;
          if (Either.isLeft(saved)) {
            reject(
              saved.left.reason === "media-rollback"
                ? "This card could not be saved and attachment cleanup failed. Your draft is preserved; restore local storage before retrying."
                : "This card could not be kept in the current tab. Your draft is preserved; reconnect and retry.",
            );
            return false;
          }
        }
        if (
          !isCurrent() ||
          localWritesBlocked() ||
          localSnapshotStale() ||
          readRef(pendingReviewRef)
        ) {
          reject(
            "Local changes are paused. Your draft is preserved; restore storage before retrying.",
          );
          return false;
        }
        if (workspaceRef.current !== current) continue;
        setWorkspace(prepared.right.workspace);
        return true;
      }
    });
    if (!isCurrent()) return;
    cardSavePending.current = false;
    setCardSaving(false);
    if (!accepted) return;
    libraryNotes.update((notes) =>
      discardLibraryDraft(notes, editingCardId ? `card:${editingCardId}` : `new-card:${area.id}`),
    );
    if (editingCardId)
      libraryNotes.update((notes) => ({
        ...notes,
        flaggedCardIds: notes.flaggedCardIds.filter((id) => id !== editingCardId),
      }));
    setNow(new Date());
    const continueAdding = saveAnother.current && !editingCardId;
    saveAnother.current = false;
    const nextKind = cardKind;
    closeCardEditor();
    if (continueAdding) {
      addCard();
      setCardKind(nextKind);
      setImportNotice("Card saved. Add your next card.");
    }
    setShowAnswer(false);
  }
  return { createCard } as const;
}
