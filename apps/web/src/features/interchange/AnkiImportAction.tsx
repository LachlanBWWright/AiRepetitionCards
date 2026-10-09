"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogTitle } from "@recall/ui-web/components/dialog";
import { Alert } from "@recall/ui-web";
import { Effect, Either } from "effect";
import { importAnkiApkg, type AnkiImportError, type AnkiImportProposal } from "@recall/application";
import { readAnkiSqliteInBrowser } from "./browser-anki-sqlite-reader";
import { readAnkiSqliteOnDesktop } from "./desktop-anki-sqlite-reader";
import { isDesktopRuntime } from "@/lib/desktop-api";

type ImportFailure = AnkiImportError["reason"] | "read-failed" | "save-failed";
export type AnkiImportState =
  | { readonly _tag: "closed" }
  | { readonly _tag: "ready" }
  | { readonly _tag: "reading"; readonly fileName: string }
  | { readonly _tag: "review"; readonly fileName: string; readonly proposal: AnkiImportProposal }
  | { readonly _tag: "saving" }
  | { readonly _tag: "error"; readonly reason: ImportFailure };

type Props = {
  readonly color: string;
  readonly onAccept: (proposal: AnkiImportProposal) => Effect.Effect<void, unknown>;
  readonly initialState?: AnkiImportState;
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

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.apkg$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80);
}

function proposalCounts(proposal: AnkiImportProposal) {
  return {
    cards: proposal.area.cards.length,
    attachments: proposal.media.length,
    reviews: proposal.reviewEvents.length,
    excludedReviews: proposal.excludedReviewCount,
    cloze: proposal.area.cards.filter((card) => card.sourceId?.endsWith(":1")).length,
  };
}

export function AnkiImportAction({ color, onAccept, initialState }: Props) {
  const [state, setState] = useState<AnkiImportState>(initialState ?? { _tag: "closed" });
  const inputRef = useRef<HTMLInputElement>(null);
  const readSequence = useRef(0);

  function close(): void {
    readSequence.current += 1;
    setState({ _tag: "closed" });
  }

  async function readFile(file: File): Promise<void> {
    if (file.size > 50_000_000) {
      setState({ _tag: "error", reason: "limits-exceeded" });
      return;
    }
    const sequence = ++readSequence.current;
    setState({ _tag: "reading", fileName: file.name });
    const decoded = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: () => ({ _tag: "AnkiFileReadFailure" }) as const,
        }).pipe(
          Effect.flatMap((buffer) =>
            importAnkiApkg(
              new Uint8Array(buffer),
              { title: titleFromFileName(file.name), color, now: new Date() },
              isDesktopRuntime() ? readAnkiSqliteOnDesktop : readAnkiSqliteInBrowser,
            ),
          ),
        ),
      ),
    );
    if (sequence !== readSequence.current) return;
    if (Either.isLeft(decoded)) {
      const error = decoded.left;
      setState({
        _tag: "error",
        reason: error._tag === "AnkiFileReadFailure" ? "read-failed" : error.reason,
      });
      return;
    }
    setState({ _tag: "review", fileName: file.name, proposal: decoded.right });
  }

  async function accept(proposal: AnkiImportProposal): Promise<void> {
    setState({ _tag: "saving" });
    const result = await Effect.runPromise(Effect.either(onAccept(proposal)));
    if (Either.isLeft(result)) {
      setState({ _tag: "error", reason: "save-failed" });
      return;
    }
    setState({ _tag: "closed" });
  }

  const proposal = state._tag === "review" ? state.proposal : undefined;
  const counts = proposal ? proposalCounts(proposal) : undefined;

  return (
    <>
      <Button variant="outline" type="button" onClick={() => setState({ _tag: "ready" })}>
        Import Anki deck
      </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".apkg,application/zip"
        aria-label="Choose Anki deck package"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void readFile(file);
        }}
      />
      <Dialog
        open={state._tag !== "closed"}
        onOpenChange={(open) => {
          if (!open && state._tag !== "reading" && state._tag !== "saving") close();
        }}
      >
        {state._tag !== "closed" && (
          <DialogContent
            className="relative max-h-[calc(100dvh-2rem)] w-[min(100%,620px)] max-w-none overflow-y-auto rounded-xl border-border bg-card p-6 text-card-foreground shadow-2xl sm:p-9"
            showCloseButton={false}
          >
            <Button
              className="absolute right-4 top-4 size-9 rounded-full border border-border bg-background text-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              type="button"
              aria-label="Close Anki import"
              disabled={state._tag === "reading" || state._tag === "saving"}
              onClick={close}
            >
              ×
            </Button>
            <p className="text-sm font-medium text-muted-foreground">Bring your decks</p>
            <DialogTitle
              id="anki-import-title"
              className="mt-2 max-w-[30rem] text-3xl font-medium tracking-tight sm:text-4xl"
            >
              Import an Anki deck
            </DialogTitle>
            {state._tag === "ready" && (
              <>
                <p className="mb-5 mt-3 max-w-[31rem] text-sm leading-7 text-muted-foreground">
                  Basic and Cloze cards, tags, images, audio, and review history are imported into a
                  fresh Knowledge Area. Imported review history rebuilds schedules with FSRS; Anki
                  intervals and due dates are not carried over.
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
                      Up to 50 MB. Supports legacy, .anki21, and modern .anki21b deck packages;
                      collection backups are not supported.
                    </p>
                  </div>
                </div>
                <Button variant="default" type="button" onClick={() => inputRef.current?.click()}>
                  Choose package
                </Button>
              </>
            )}
            {state._tag === "reading" && (
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
                  <strong className="mb-1 block text-sm font-semibold">
                    Reading {state.fileName}
                  </strong>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Checking the package, cards, and attachments…
                  </p>
                </div>
              </div>
            )}
            {state._tag === "saving" && (
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
                  <strong className="mb-1 block text-sm font-semibold">
                    Adding cards to your workspace
                  </strong>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Saving verified attachments and rebuilding FSRS schedules…
                  </p>
                </div>
              </div>
            )}
            {state._tag === "review" && proposal && counts && (
              <>
                <p className="mb-5 mt-3 max-w-[31rem] text-sm leading-7 text-muted-foreground">
                  Review this preview before adding anything to your workspace. Imported review
                  history is retained and used to rebuild FSRS schedules; unsafe formatting is
                  removed.
                </p>
                <div className="rounded-xl bg-muted/60 p-4 sm:px-5">
                  <h3 className="mb-1 text-xl font-medium">{proposal.area.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {counts.cards} cards · {counts.reviews} reviews · {counts.attachments} verified
                    attachments
                  </p>
                  {counts.excludedReviews > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {counts.excludedReviews} cram or reschedule log entries were excluded from
                      review history.
                    </p>
                  )}
                  {proposal.provenance.deckNames.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Decks: {proposal.provenance.deckNames.join(" · ")}
                    </p>
                  )}
                </div>
                <div className="my-4 rounded-xl border border-border bg-background p-4 sm:px-5">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground">
                    Question
                  </span>
                  <p className="my-1 whitespace-pre-wrap leading-6">
                    {proposal.area.cards[0]?.front ?? "No cards to preview"}
                  </p>
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground">
                    Answer
                  </span>
                  <p className="mb-0 mt-1 whitespace-pre-wrap leading-6">
                    {proposal.area.cards[0]?.back ?? ""}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setState({ _tag: "ready" })}
                  >
                    Choose another
                  </Button>
                  <Button variant="default" type="button" onClick={() => void accept(proposal)}>
                    Add {counts.cards} cards
                  </Button>
                </div>
              </>
            )}
            {state._tag === "error" && (
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
                  <strong className="mb-1 block text-sm font-semibold">
                    Import couldn’t continue
                  </strong>
                  <p className="text-sm leading-6">{failureCopy[state.reason]}</p>
                </div>
              </Alert>
            )}
            {state._tag === "error" && (
              <Button variant="outline" type="button" onClick={() => setState({ _tag: "ready" })}>
                Try another package
              </Button>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
