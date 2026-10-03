"use client";

import { useRef, useState } from "react";
import { Effect, Either } from "effect";
import { importAnkiApkg, type AnkiImportError, type AnkiImportProposal } from "@recall/application";
import { readAnkiSqliteInBrowser } from "./browser-anki-sqlite-reader";
import { readAnkiSqliteOnDesktop } from "./desktop-anki-sqlite-reader";
import { isDesktopRuntime } from "@/lib/desktop-api";
import "./anki-import.css";

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
      <button className="text-button" type="button" onClick={() => setState({ _tag: "ready" })}>
        Import Anki deck
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".apkg,application/zip"
        aria-label="Choose Anki deck package"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void readFile(file);
        }}
      />
      {state._tag !== "closed" && (
        <div
          className="anki-import-backdrop"
          onMouseDown={() => {
            if (state._tag !== "reading" && state._tag !== "saving") close();
          }}
        >
          <section
            className="anki-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="anki-import-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="anki-import-close"
              type="button"
              aria-label="Close Anki import"
              disabled={state._tag === "reading" || state._tag === "saving"}
              onClick={close}
            >
              ×
            </button>
            <p className="eyebrow">BRING YOUR DECKS</p>
            <h2 id="anki-import-title">Import an Anki deck</h2>
            {state._tag === "ready" && (
              <>
                <p className="anki-import-intro">
                  Basic and Cloze cards, tags, images, audio, and review history are imported into a
                  fresh Knowledge Area. Imported review history rebuilds schedules with FSRS; Anki
                  intervals and due dates are not carried over.
                </p>
                <div className="anki-import-supported">
                  <span aria-hidden="true">↗</span>
                  <div>
                    <strong>Choose a deck package (.apkg)</strong>
                    <p>
                      Up to 50 MB. Supports legacy, .anki21, and modern .anki21b deck packages;
                      collection backups are not supported.
                    </p>
                  </div>
                </div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose package
                </button>
              </>
            )}
            {state._tag === "reading" && (
              <div className="anki-import-progress" role="status" aria-live="polite">
                <span className="anki-import-spinner" aria-hidden="true" />
                <div>
                  <strong>Reading {state.fileName}</strong>
                  <p>Checking the package, cards, and attachments…</p>
                </div>
              </div>
            )}
            {state._tag === "saving" && (
              <div className="anki-import-progress" role="status" aria-live="polite">
                <span className="anki-import-spinner" aria-hidden="true" />
                <div>
                  <strong>Adding cards to your workspace</strong>
                  <p>Saving verified attachments and rebuilding FSRS schedules…</p>
                </div>
              </div>
            )}
            {state._tag === "review" && proposal && counts && (
              <>
                <p className="anki-import-intro">
                  Review this preview before adding anything to your workspace. Imported review
                  history is retained and used to rebuild FSRS schedules; unsafe formatting is
                  removed.
                </p>
                <div className="anki-import-summary">
                  <h3>{proposal.area.title}</h3>
                  <p>
                    {counts.cards} cards · {counts.reviews} reviews · {counts.attachments} verified
                    attachments
                  </p>
                  {counts.excludedReviews > 0 && (
                    <p className="anki-import-decks">
                      {counts.excludedReviews} cram or reschedule log entries were excluded from
                      review history.
                    </p>
                  )}
                  {proposal.provenance.deckNames.length > 0 && (
                    <p className="anki-import-decks">
                      Decks: {proposal.provenance.deckNames.join(" · ")}
                    </p>
                  )}
                </div>
                <div className="anki-import-card-preview">
                  <span>QUESTION</span>
                  <p>{proposal.area.cards[0]?.front ?? "No cards to preview"}</p>
                  <span>ANSWER</span>
                  <p>{proposal.area.cards[0]?.back ?? ""}</p>
                </div>
                <div className="anki-import-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => setState({ _tag: "ready" })}
                  >
                    Choose another
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => void accept(proposal)}
                  >
                    Add {counts.cards} cards
                  </button>
                </div>
              </>
            )}
            {state._tag === "error" && (
              <div className="anki-import-error" role="alert">
                <span aria-hidden="true">!</span>
                <div>
                  <strong>Import couldn’t continue</strong>
                  <p>{failureCopy[state.reason]}</p>
                </div>
              </div>
            )}
            {state._tag === "error" && (
              <button
                className="secondary-action"
                type="button"
                onClick={() => setState({ _tag: "ready" })}
              >
                Try another package
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
