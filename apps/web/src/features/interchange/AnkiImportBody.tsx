import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web";
import type { AnkiImportProposal } from "@recall/application";
import type { AnkiImportState } from "./AnkiImportAction";

type ImportFailure = Extract<AnkiImportState, { readonly _tag: "error" }>["reason"];
type Props = {
  readonly state: AnkiImportState;
  readonly onChoosePackage: () => void;
  readonly onReset: () => void;
  readonly onAccept: (proposal: AnkiImportProposal) => Promise<void>;
};
const failureCopy: Record<ImportFailure, string> = {
  "invalid-input": "Choose an Anki .apkg package to continue.",
  "limits-exceeded": "This package exceeds the supported import limits.",
  "unsupported-format":
    "This file is not a supported Anki deck package. Anki collection backups are not supported.",
  "invalid-archive": "The package archive is invalid or contains unsafe file paths.",
  "invalid-database": "The package’s Anki database could not be read.",
  "unsupported-note-type":
    "This deck uses a note type or card template that is not supported yet. Basic and Cloze notes are supported.",
  "invalid-note": "The package contains a note that could not be converted into a study card.",
  "invalid-media": "A card refers to missing or unsupported media.",
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

export function AnkiImportBody({ state, onChoosePackage, onReset, onAccept }: Props) {
  switch (state._tag) {
    case "ready":
      return <ReadyImport onChoosePackage={onChoosePackage} />;
    case "reading":
      return (
        <ImportProgress
          title={`Reading ${state.fileName}`}
          detail="Checking the package, cards, and attachments…"
        />
      );
    case "saving":
      return (
        <ImportProgress
          title="Adding cards to your workspace"
          detail="Saving verified attachments and rebuilding FSRS schedules…"
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
function ReadyImport({ onChoosePackage }: { readonly onChoosePackage: () => void }) {
  return (
    <>
      <p className="mb-5 mt-3 max-w-[31rem] text-sm leading-7 text-muted-foreground">
        Basic and Cloze cards, tags, images, audio, and review history are imported into a fresh
        Knowledge Area. Imported review history rebuilds schedules with FSRS; Anki intervals and due
        dates are not carried over.
      </p>
      <div className="mb-5 flex items-start gap-4 rounded-xl border border-border bg-muted/40 p-4">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-lg text-primary"
          aria-hidden="true"
        >
          ↗
        </span>
        <div>
          <strong className="mb-1 block text-sm font-semibold">
            Choose a deck package (.apkg)
          </strong>
          <p className="text-sm leading-6 text-muted-foreground">
            Up to 50 MB. Supports legacy, .anki21, and modern .anki21b deck packages; collection
            backups are not supported.
          </p>
        </div>
      </div>
      <Button variant="default" type="button" onClick={onChoosePackage}>
        Choose package
      </Button>
    </>
  );
}
function ImportProgress({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div
      className="mt-6 flex items-start gap-4 rounded-xl border border-border bg-muted/40 p-4"
      role="status"
      aria-live="polite"
    >
      <span
        className="mt-1 size-5 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div>
        <strong className="mb-1 block text-sm font-semibold">{title}</strong>
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
    <>
      <p className="mb-5 mt-3 max-w-[31rem] text-sm leading-7 text-muted-foreground">
        Review this preview before adding anything to your workspace. Imported review history is
        retained and used to rebuild FSRS schedules; unsafe formatting is removed.
      </p>
      <div className="rounded-xl bg-muted/60 p-4 sm:px-5">
        <h3 className="mb-1 text-xl font-medium">{proposal.area.title}</h3>
        <p className="text-sm text-muted-foreground">
          {counts.cards} cards · {counts.reviews} reviews · {counts.attachments} verified
          attachments
        </p>
        {counts.excludedReviews > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {counts.excludedReviews} cram or reschedule log entries were excluded from review
            history.
          </p>
        )}
        {proposal.provenance.deckNames.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Decks: {proposal.provenance.deckNames.join(" · ")}
          </p>
        )}
      </div>
      <div className="my-4 rounded-xl border border-border bg-background p-4 sm:px-5">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">Question</span>
        <p className="my-1 whitespace-pre-wrap leading-6">
          {proposal.area.cards[0]?.front ?? "No cards to preview"}
        </p>
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">Answer</span>
        <p className="mb-0 mt-1 whitespace-pre-wrap leading-6">
          {proposal.area.cards[0]?.back ?? ""}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">
        <Button variant="outline" type="button" onClick={onReset}>
          Choose another
        </Button>
        <Button variant="default" type="button" onClick={() => void onAccept(proposal)}>
          Add {counts.cards} cards
        </Button>
      </div>
    </>
  );
}
function ImportError({
  reason,
  onReset,
}: Pick<Props, "onReset"> & { readonly reason: ImportFailure }) {
  return (
    <>
      <Alert
        className="my-5 flex items-start gap-4 border-destructive/30 bg-destructive/10"
        variant="destructive"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/15 font-bold text-destructive"
          aria-hidden="true"
        >
          !
        </span>
        <div>
          <strong className="mb-1 block text-sm font-semibold">Import couldn’t continue</strong>
          <p className="text-sm leading-6">{failureCopy[reason]}</p>
        </div>
      </Alert>
      <Button variant="outline" type="button" onClick={onReset}>
        Try another package
      </Button>
    </>
  );
}
