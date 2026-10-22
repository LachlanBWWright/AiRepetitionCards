"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AnkiImportBody } from "./AnkiImportBody";
import { Dialog, DialogContent, DialogTitle } from "@recall/ui-web/components/dialog";
import { Effect, Either } from "effect";
import { importAnkiApkg, type AnkiImportError, type AnkiImportProposal } from "@recall/application";
import { readAnkiSqliteInBrowser } from "./browser-anki-sqlite-reader";
import { readAnkiSqliteOnDesktop } from "./desktop-anki-sqlite-reader";
import { isDesktopRuntime } from "@/lib/desktop-api";

type ImportFailure =
  | AnkiImportError["reason"]
  | "read-failed"
  | "save-failed"
  | "ambiguous-matches"
  | "partial-note-family";
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

function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.(?:apkg|colpkg)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 80);
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
    setState({ _tag: "closed" });
  }

  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={() => {
          setState({ _tag: "ready" });
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
            className="rounded-xl border-border bg-card text-card-foreground shadow-2xl sm:max-w-[620px] sm:p-9"
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
            <AnkiImportBody
              state={state}
              onChoosePackage={() => {
                inputRef.current?.click();
              }}
              onReset={() => {
                setState({ _tag: "ready" });
              }}
              onAccept={accept}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
