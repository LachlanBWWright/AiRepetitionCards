"use client";

import { useAnkiImportReader } from "./useAnkiImportReader";
import { readAnkiDraft, clearAnkiDraft } from "./anki-import-draft";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AnkiImportBody } from "./AnkiImportBody";
import { Dialog, DialogContent, DialogTitle } from "@recall/ui-web/components/dialog";
import { Effect, Either } from "effect";
import {
  type AnkiImportProgress,
  type AnkiImportError,
  type AnkiImportProposal,
} from "@recall/application";
import { readAnkiSqliteInBrowser } from "./browser-anki-sqlite-reader";
import { readAnkiSqliteOnDesktop } from "./desktop-anki-sqlite-reader";
import { isDesktopRuntime } from "@/lib/desktop-api";

type ImportFailure =
  | AnkiImportError["reason"]
  | "read-failed"
  | "save-failed"
  | "ambiguous-matches"
  | "partial-note-family"
  | "draft-delete-failed"
  | "source-cleanup-failed";
export type AnkiImportState =
  | { readonly _tag: "closed" }
  | { readonly _tag: "ready"; readonly draftName?: string }
  | {
      readonly _tag: "reading";
      readonly fileName: string;
      readonly progress?: AnkiImportProgress | undefined;
      readonly draftSaved?: boolean | undefined;
      readonly paused?: boolean;
    }
  | { readonly _tag: "review"; readonly fileName: string; readonly proposal: AnkiImportProposal }
  | { readonly _tag: "saving" }
  | { readonly _tag: "error"; readonly reason: ImportFailure };

type Props = {
  readonly color: string;
  readonly onAccept: (proposal: AnkiImportProposal) => Effect.Effect<void, unknown>;
  readonly initialState?: AnkiImportState;
};

export function AnkiImportAction({ color, onAccept, initialState }: Props) {
  const [state, setState] = useState<AnkiImportState>(initialState ?? { _tag: "closed" });
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRevision = useRef(0);
  const [persistDraft, setPersistDraft] = useState(false);
  const [draft, setDraft] = useState<File | null>(null);
  const reader = useAnkiImportReader({
    color,
    persistDraft,
    setState,
    readSqlite: isDesktopRuntime() ? readAnkiSqliteOnDesktop : readAnkiSqliteInBrowser,
  });
  useEffect(() => {
    let active = true;
    const revision = draftRevision.current;
    void Effect.runPromise(readAnkiDraft().pipe(Effect.catchAll(() => Effect.succeed(null)))).then(
      (file) => {
        if (active && revision === draftRevision.current) setDraft(file);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  function close(): void {
    reader.cancel();
    setState({ _tag: "closed" });
  }

  async function accept(proposal: AnkiImportProposal): Promise<void> {
    setState({ _tag: "saving" });
    const result = await Effect.runPromise(Effect.either(onAccept(proposal)));
    if (Either.isLeft(result)) {
      const error = result.left;
      const reason =
        typeof error === "object" &&
        error !== null &&
        "reason" in error &&
        (error.reason === "ambiguous-matches" || error.reason === "partial-note-family")
          ? error.reason
          : "save-failed";
      setState({ _tag: "error", reason });
      return;
    }
    await Effect.runPromise(clearAnkiDraft().pipe(Effect.ignore));
    draftRevision.current += 1;
    setDraft(null);
    setState({ _tag: "closed" });
  }

  async function discardDraft(): Promise<void> {
    const revision = ++draftRevision.current;
    const result = await Effect.runPromise(Effect.either(clearAnkiDraft()));
    if (revision !== draftRevision.current) return;
    if (Either.isLeft(result)) {
      setState({ _tag: "error", reason: "draft-delete-failed" });
      return;
    }
    setDraft(null);
    setState({ _tag: "ready" });
  }
  const visibleState =
    state._tag === "ready" && draft ? { ...state, draftName: draft.name } : state;
  return (
    <>
      <Button
        variant="default"
        type="button"
        onClick={() => {
          setState({ _tag: "ready", ...(draft ? { draftName: draft.name } : {}) });
        }}
      >
        Import Anki deck
      </Button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".apkg,.colpkg,application/zip"
        aria-label="Choose Anki deck package"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            draftRevision.current += 1;
            setDraft(file);
            void reader.readFile(file);
          }
        }}
      />
      <Dialog
        open={state._tag !== "closed"}
        onOpenChange={(open) => {
          if (!open && state._tag !== "saving") close();
        }}
      >
        {state._tag !== "closed" && (
          <DialogContent
            className="rounded-xl border-border bg-card text-card-foreground shadow-2xl sm:max-w-[620px] sm:p-9"
            showCloseButton={false}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4"
              type="button"
              aria-label="Close Anki import"
              disabled={state._tag === "saving"}
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
            <AnkiImportBody
              state={visibleState}
              persistDraft={persistDraft}
              onPersistDraftChange={setPersistDraft}
              onChoosePackage={() => {
                inputRef.current?.click();
              }}
              onReset={() => {
                setState({ _tag: "ready", ...(draft ? { draftName: draft.name } : {}) });
              }}
              onAccept={accept}
              onTogglePause={reader.togglePause}
              onResumeDraft={() => {
                if (draft) void reader.readFile(draft);
              }}
              onDiscardDraft={() => {
                void discardDraft();
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
