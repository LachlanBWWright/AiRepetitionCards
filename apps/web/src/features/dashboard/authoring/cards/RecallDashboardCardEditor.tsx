import { createNoteDraftPort } from "@recall/react";
import { useState } from "react";
import { NoteLibraryEditor } from "../notes/NoteLibraryEditor";
import { PronunciationRecorder } from "@/components/cards/PronunciationRecorder";
import { CardOcclusionEditor } from "@/components/occlusion/CardOcclusionEditor";
import { ReviewPresentationSettings } from "@/components/cards/ReviewPresentationSettings";
import { Either } from "effect";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { Alert } from "@recall/ui-web/components/alert";
import { RecallDashboardCardEditorFields } from "@/features/dashboard/authoring/cards/RecallDashboardCardEditorFields";
import type { RecallDashboardModel } from "../../state/useRecallDashboardController";
import { RecallDashboardCardAssistance } from "./RecallDashboardCardAssistance";
import { RecallDashboardCardDuplicateSection } from "./RecallDashboardCardDuplicateSection";
import { RecallDashboardCardDetails } from "./RecallDashboardCardDetails";
import { RecallDashboardCardEditorActions } from "./RecallDashboardCardEditorActions";
import { canSaveCardDraft } from "./cardEditorValidation";
import { RecallDashboardCardPromptFields } from "./RecallDashboardCardPromptFields";

function ReopenLatestCardButton({
  disabled,
  onClick,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
      disabled={disabled}
      onClick={onClick}
    >
      Reopen latest saved card
    </Button>
  );
}

export function RecallDashboardCardEditor({ model }: { readonly model: RecallDashboardModel }) {
  const [sharedNotes, setSharedNotes] = useState(false);
  const linkedNoteId = model.cardEditor.current.sourceCard?.noteId;
  const {
    addingCard,
    workspaceUnlocked,
    requestDraftClose,
    createCard,
    cardSaving,
    editingCardId,
    area,
    cardEditorError,
    cardDraftStale,
    workspaceRef,
    requestConfirmation,
    editCard,
    cardKind,
    setCardKind,
    cardEditor,
    front,
    setFront,
    back,
    setBack,
    clozeText,
    setClozeText,
    clozeIndex,
    setClozeIndex,
    clozePreview,
    tutorAreaDocument,
    duplicateCandidates,
    demo,
    ready,
    cacheWritable,
    mediaFile,
    setCardSaving,
    applyCardRefinement,
    duplicateDraft,
    duplicateKey,
    duplicateAcknowledgement,
    setDuplicateAcknowledgement,
    cardObjectiveIds,
    setCardObjectiveIds,
    cardTags,
    setCardTags,
    removedMediaIds,
    setRemovedMediaIds,
    setMediaFile,
    duplicatesAccepted,
  } = model;
  function reopenLatestSavedCard() {
    if (!editingCardId) return;
    const latest = workspaceRef.current.areas
      .flatMap((item) => item.cards)
      .find((item) => item.id === editingCardId);
    if (!latest) return;
    requestConfirmation(
      "Replace this draft with the latest saved card? Copy any text you want to keep first.",
      () => {
        editCard(latest);
      },
    );
  }
  function openDuplicateCandidate(candidate: (typeof duplicateCandidates)[number]) {
    const existing = workspaceRef.current.areas
      .flatMap((item) => item.cards)
      .find((item) => item.id === candidate.id);
    if (existing)
      requestConfirmation("Discard this draft and open the existing card?", () => {
        editCard(existing);
      });
  }
  const clozePreviewValue =
    clozePreview && Either.isRight(clozePreview)
      ? { front: clozePreview.right.front, back: clozePreview.right.back }
      : null;
  const assistanceArea =
    tutorAreaDocument && Either.isRight(tutorAreaDocument) ? tutorAreaDocument.right : null;
  const cardFields = (
    <RecallDashboardCardEditorFields cardSaving={cardSaving}>
      <RecallDashboardCardPromptFields
        media={(cardEditor.current.sourceCard?.media ?? []).filter(
          (item) => !removedMediaIds.includes(item.id),
        )}
        cardKind={cardKind}
        setCardKind={setCardKind}
        generation={cardEditor.current.generation}
        front={front}
        setFront={setFront}
        back={back}
        setBack={setBack}
        clozeText={clozeText}
        setClozeText={setClozeText}
        clozeIndex={clozeIndex}
        setClozeIndex={setClozeIndex}
        clozePreview={clozePreviewValue}
      />
      <CardOcclusionEditor
        sourceCard={model.cardEditor.current.sourceCard ?? undefined}
        value={model.imageOcclusion}
        onChange={model.setImageOcclusion}
        removedMediaIds={removedMediaIds}
        disabled={cardSaving}
      />
      <RecallDashboardCardAssistance
        area={assistanceArea}
        candidates={duplicateCandidates}
        cardKind={cardKind}
        front={front}
        back={back}
        clozeText={clozeText}
        clozePreview={clozePreview && Either.isRight(clozePreview) ? clozePreview.right : null}
        objectiveId={cardObjectiveIds[0] ?? null}
        editingCardId={editingCardId}
        saving={cardSaving}
        mediaFile={mediaFile}
        stale={cardDraftStale}
        demo={Boolean(demo)}
        ready={ready}
        cacheWritable={cacheWritable}
        onBusyChange={setCardSaving}
        onApply={applyCardRefinement}
      />
      <RecallDashboardCardDuplicateSection
        draft={duplicateDraft}
        candidates={duplicateCandidates}
        editingCardId={editingCardId}
        acknowledgement={duplicateAcknowledgement}
        duplicateKey={duplicateKey}
        saving={cardSaving}
        onAcknowledgementChange={(value) => {
          setDuplicateAcknowledgement(value ? duplicateKey : null);
        }}
        onOpenCandidate={openDuplicateCandidate}
      />
      <RecallDashboardCardDetails
        objectives={area?.objectives}
        objectiveIds={cardObjectiveIds}
        setObjectiveIds={setCardObjectiveIds}
        tags={cardTags}
        setTags={setCardTags}
        sourceMedia={cardEditor.current.sourceCard?.media ?? []}
        removedMediaIds={removedMediaIds}
        setRemovedMediaIds={setRemovedMediaIds}
        mediaFile={mediaFile}
        setMediaFile={setMediaFile}
      />
      <RecallDashboardCardEditorActions
        editing={Boolean(editingCardId)}
        saving={cardSaving}
        duplicatesAccepted={duplicatesAccepted}
        canSave={canSaveCardDraft({
          kind: cardKind,
          front,
          back,
          hasClozePreview: Boolean(clozePreview && Either.isRight(clozePreview)),
        })}
        onCancel={() => {
          requestDraftClose("card");
        }}
      />
    </RecallDashboardCardEditorFields>
  );
  return (
    <Dialog
      open={addingCard && workspaceUnlocked}
      onOpenChange={(open) => {
        if (!open) requestDraftClose("card");
      }}
    >
      <DialogContent
        aria-labelledby="card-dialog-title"
        className={`max-h-[calc(100dvh-2.5rem)] overflow-y-auto ${sharedNotes || linkedNoteId ? "sm:max-w-3xl" : ""}`}
        showCloseButton={false}
      >
        <form
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
          onSubmit={(event) => {
            if (sharedNotes || linkedNoteId) event.preventDefault();
            else void createCard(event);
          }}
        >
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute top-4 right-4 size-8 text-[var(--muted)] hover:bg-[var(--surface-hover)]"
            disabled={cardSaving}
            onClick={() => {
              requestDraftClose("card");
            }}
            aria-label="Close card editor"
          >
            ×
          </Button>
          {!(sharedNotes || linkedNoteId) && (
            <>
              <PronunciationRecorder onAttach={setMediaFile} disabled={cardSaving} />
              <ReviewPresentationSettings
                value={model.cardPresentation}
                onChange={model.setCardPresentation}
              />
            </>
          )}
          <DialogHeader className="pr-10">
            <DialogTitle id="card-dialog-title">
              {editingCardId ? "Edit card" : "Add card"}
            </DialogTitle>
            <DialogDescription>{area?.title}</DialogDescription>
          </DialogHeader>
          {cardEditorError && (
            <Alert variant="destructive">
              <p>{cardEditorError}</p>
              {cardDraftStale && editingCardId && (
                <ReopenLatestCardButton disabled={cardSaving} onClick={reopenLatestSavedCard} />
              )}
            </Alert>
          )}
          {!editingCardId && (
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => {
                setSharedNotes(!sharedNotes);
              }}
            >
              {sharedNotes ? "Use individual card editor" : "Use shared notes and templates"}
            </Button>
          )}
          {(sharedNotes || linkedNoteId) && area ? (
            <NoteLibraryEditor
              key={`${area.id}:${linkedNoteId ?? "new"}`}
              workspace={model.workspace}
              area={area}
              save={model.saveAuthoringCommand}
              createId={() => crypto.randomUUID()}
              initialNoteId={linkedNoteId}
              disabled={cardSaving || !model.cacheWritable}
              draftsLoaded={model.libraryNotes.loaded}
              draftPort={createNoteDraftPort(model.libraryNotes.notes, model.libraryNotes.update)}
            />
          ) : (
            cardFields
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
