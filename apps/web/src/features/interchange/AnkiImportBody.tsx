import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Label } from "@recall/ui-web/components/label";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web";
import { DialogFooter } from "@recall/ui-web/components/dialog";
import type { AnkiImportProposal } from "@recall/application";
import type { AnkiImportState } from "./AnkiImportAction";

type ImportFailure = Extract<AnkiImportState, { readonly _tag: "error" }>["reason"];
type Props = {
  readonly persistDraft?: boolean | undefined;
  readonly onPersistDraftChange?: ((value: boolean) => void) | undefined;
  readonly state: AnkiImportState;
  readonly onTogglePause?: (() => void) | undefined;
  readonly onResumeDraft?: (() => void) | undefined;
  readonly onDiscardDraft?: (() => void) | undefined;
  readonly onChoosePackage: () => void;
  readonly onReset: () => void;
  readonly onAccept: (proposal: AnkiImportProposal) => Promise<void>;
};
const failureCopy: Record<ImportFailure, string> = {
  "source-cleanup-failed":
    "Your cards were saved, but the source package could not be removed. The file remains on this device. Discard the saved package or clear device data.",
  "draft-delete-failed":
    "The saved source package could not be removed. It remains on this device. Retry discarding it or clear device data.",
  "ambiguous-matches":
    "Matching Anki identities occur in multiple areas or are duplicated. Resolve those duplicates before re-importing.",
  "partial-note-family":
    "This update omits existing cards from a shared note. Export and import the complete note family to update it safely.",
  "invalid-input": "Choose an Anki .apkg package to continue.",
  "limits-exceeded": "This package exceeds the supported import limits.",
  "unsupported-format":
    "This file is not a supported Anki deck package. Collection packages import content; they do not restore Anki preferences.",
  "invalid-archive": "The package archive is invalid or contains unsafe file paths.",
  "invalid-database": "The package’s Anki database could not be read.",
  "unsupported-note-type":
    "This deck uses a note type or card template that is not supported yet. Static field templates, Basic and Cloze notes are supported. Executable templates and unsupported filters are rejected.",
  "invalid-note": "The package contains a note that could not be converted into a study card.",
  "invalid-media":
    "An attachment is missing, unsafe or unsupported. Re-export the deck from Anki with media included, then try again. Remote images and audio can be imported as marked placeholders.",
  "media-too-large": "An attachment in this package is too large to import.",
  "invalid-proposal": "The imported content did not pass validation.",
  "read-failed": "The selected file could not be read.",
  "save-failed":
    "The imported cards or attachments could not be saved. Your workspace was left unchanged.",
};

function proposalCounts(proposal: AnkiImportProposal) {
  return {
    cards: proposal.area.cards.length,
    attachments: proposal.media.length,
    reviews: proposal.reviewEvents.length,
    excludedReviews: proposal.excludedReviewCount,
    cloze: proposal.area.cards.filter((card) => card.sourceId?.endsWith(":1")).length,
  };
}

export function AnkiImportBody({
  state,
  onChoosePackage,
  onReset,
  onAccept,
  onTogglePause,
  onResumeDraft,
  onDiscardDraft,
  persistDraft,
  onPersistDraftChange,
}: Props) {
  switch (state._tag) {
    case "ready":
      return (
        <ReadyImport
          onChoosePackage={onChoosePackage}
          persistDraft={persistDraft}
          onPersistDraftChange={onPersistDraftChange}
          draftName={state.draftName}
          onResumeDraft={onResumeDraft}
          onDiscardDraft={onDiscardDraft}
        />
      );
    case "reading":
      return (
        <div className="flex flex-col gap-4">
          <ImportProgress
            title={`${state.paused ? "Paused" : "Reading"} ${state.fileName}`}
            detail={
              state.progress
                ? `${state.progress.phase}: ${String(Math.round((state.progress.completed / Math.max(1, state.progress.total)) * 100))}%`
                : "Checking the package, cards, and attachments…"
            }
          />
          <Button variant="default" onClick={onTogglePause}>
            {state.paused ? "Resume" : "Pause"}
          </Button>
          {state.draftSaved === false && (
            <Alert variant="destructive">
              The source package could not be kept for resume. Keep the original file to restart
              after closing.
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            Closing cancels processing. A saved package can be resumed after reopening the app;
            validation starts again.
          </p>
        </div>
      );
    case "saving":
      return (
        <ImportProgress
          title="Importing cards into your workspace"
          detail="Saving verified attachments and schedules…"
        />
      );
    case "review":
      return <ImportPreview proposal={state.proposal} onReset={onReset} onAccept={onAccept} />;
    case "error":
      return <ImportError reason={state.reason} onReset={onReset} />;
    case "closed":
      return null;
  }
}
function ReadyImport({
  onChoosePackage,
  draftName,
  onResumeDraft,
  onDiscardDraft,
  persistDraft,
  onPersistDraftChange,
}: Pick<
  Props,
  "onChoosePackage" | "onResumeDraft" | "onDiscardDraft" | "persistDraft" | "onPersistDraftChange"
> & {
  readonly draftName?: string | undefined;
}) {
  const persistenceId = useId();
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[31rem] text-sm leading-7 text-muted-foreground">
        Basic, reversed and static custom cards, Cloze notes, tags, media and review history are
        imported into a Knowledge Area. Matching cards update their content while retaining local
        study history. Supported legacy schedules retain due dates and intervals; other schedules
        are rebuilt with FSRS.
      </p>
      <div className="flex items-start gap-4 rounded-xl border border-border bg-muted/40 p-4">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-lg text-primary"
          aria-hidden="true"
        >
          ↗
        </span>
        <div className="grid gap-2">
          <strong className="block text-sm font-semibold">
            Choose a package (.apkg or .colpkg)
          </strong>
          <p className="text-sm leading-6 text-muted-foreground">
            Up to 100 MB and 2,000 attachments within a 100 MB expanded budget. Supports legacy,
            .anki21, and modern .anki21b packages. Collection packages import content rather than
            replacing your workspace.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={persistenceId}
          checked={persistDraft ?? false}
          onCheckedChange={(checked) => onPersistDraftChange?.(checked === true)}
        />
        <Label htmlFor={persistenceId}>
          Keep the chosen package on this device to resume after closing the app. It may contain
          private study history. Discard it here to remove the saved copy.
        </Label>
      </div>
      <Button variant="default" type="button" onClick={onChoosePackage}>
        Choose package
      </Button>
      {draftName && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Unfinished import: {draftName}. Resume rechecks the saved package before approval.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onResumeDraft}>Resume import</Button>
            <Button variant="secondary" onClick={onDiscardDraft}>
              Discard saved package
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function ImportProgress({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div
      className="flex items-start gap-4 rounded-xl border border-border bg-muted/40 p-4"
      role="status"
      aria-live="polite"
    >
      <span
        className="mt-1 size-5 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div className="grid gap-1">
        <strong className="block text-sm font-semibold">{title}</strong>
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
function ImportPreview({
  proposal,
  onReset,
  onAccept,
}: Pick<Props, "onReset" | "onAccept"> & { readonly proposal: AnkiImportProposal }) {
  const counts = proposalCounts(proposal);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[31rem] text-sm leading-7 text-muted-foreground">
        Review this preview before adding anything to your workspace. Imported review history is
        retained. Supported legacy due dates and intervals are preserved; unsafe formatting is
        removed.
      </p>
      <div className="grid gap-2 rounded-xl bg-muted/60 p-4 sm:px-5">
        <h3 className="text-xl font-medium">{proposal.area.title}</h3>
        <p className="text-sm text-muted-foreground">
          {counts.cards} cards · {counts.reviews} reviews · {counts.attachments} verified
          attachments
        </p>
        {counts.excludedReviews > 0 && (
          <p className="text-xs text-muted-foreground">
            {counts.excludedReviews} cram or reschedule log entries were excluded from review
            history.
          </p>
        )}
        {proposal.compatibility && (
          <p className="text-xs text-muted-foreground">
            {proposal.compatibility.changedFieldCount} fields changed by safe conversion ·{" "}
            {proposal.compatibility.omittedUnreferencedAttachments} unreferenced attachments omitted
          </p>
        )}
        {proposal.warnings?.map((warning) => (
          <p key={warning} className="text-xs text-muted-foreground">
            {warning}
          </p>
        ))}
        {proposal.provenance.deckNames.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Decks: {proposal.provenance.deckNames.join(" · ")}
          </p>
        )}
      </div>
      {proposal.compatibility && (
        <div className="flex flex-col gap-3">
          {proposal.compatibility.samples.map((sample) => (
            <div
              key={`${sample.noteGuid}:${sample.fieldName}`}
              className="grid gap-2 rounded-lg border p-3 text-xs"
            >
              <strong>{sample.fieldName} · formatting conversion preview</strong>
              <p className="text-muted-foreground">Source (first 1,000 characters)</p>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{sample.original}</pre>
              <p className="text-muted-foreground">Imported safe text</p>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{sample.imported}</pre>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 rounded-xl border border-border bg-background p-4 sm:px-5">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">Question</span>
        <p className="whitespace-pre-wrap leading-6">
          {proposal.area.cards[0]?.front ?? "No cards to preview"}
        </p>
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">Answer</span>
        <p className="whitespace-pre-wrap leading-6">{proposal.area.cards[0]?.back ?? ""}</p>
      </div>
      <DialogFooter>
        <Button variant="default" type="button" onClick={onReset}>
          Choose another
        </Button>
        <Button variant="default" type="button" onClick={() => void onAccept(proposal)}>
          Import {counts.cards} cards
        </Button>
      </DialogFooter>
    </div>
  );
}
function ImportError({
  reason,
  onReset,
}: Pick<Props, "onReset"> & { readonly reason: ImportFailure }) {
  const cleanup = reason === "draft-delete-failed" || reason === "source-cleanup-failed";
  const title =
    reason === "source-cleanup-failed"
      ? "Cards imported; cleanup needed"
      : "Import couldn’t continue";
  return (
    <div className="flex flex-col gap-4">
      <Alert
        className="flex items-start gap-4 border-destructive/30 bg-destructive/10"
        variant="destructive"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/15 font-bold text-[var(--recall-danger-foreground)]"
          aria-hidden="true"
        >
          !
        </span>
        <div className="grid gap-1">
          <strong className="block text-sm font-semibold">{title}</strong>
          <p className="text-sm leading-6">{failureCopy[reason]}</p>
        </div>
      </Alert>
      <Button variant="default" type="button" onClick={onReset}>
        {cleanup ? "Manage saved package" : "Try another package"}
      </Button>
    </div>
  );
}
