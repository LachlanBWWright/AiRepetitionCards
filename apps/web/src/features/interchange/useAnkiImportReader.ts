import { useEffect, useRef } from "react";
import { Effect, Either } from "effect";
import {
  MAX_ANKI_PACKAGE_BYTES,
  importAnkiApkg,
  type AnkiImportProgress,
  type AnkiSqliteReader,
} from "@recall/application";
import type { AnkiImportState } from "./AnkiImportAction";
import { saveAnkiDraft } from "./anki-import-draft";

type Dependencies = {
  readonly color: string;
  readonly persistDraft: boolean;
  readonly readSqlite: AnkiSqliteReader;
  readonly setState: (state: AnkiImportState) => void;
};
export function useAnkiImportReader({ color, readSqlite, setState, persistDraft }: Dependencies) {
  const active = useRef<AbortController | null>(null);
  const paused = useRef(false);
  const continueReading = useRef<(() => void) | null>(null);
  const draftSaved = useRef<boolean | undefined>(undefined);
  const progress = useRef<AnkiImportProgress | undefined>(undefined);
  const fileName = useRef("");
  useEffect(() => () => active.current?.abort(), []);
  function cancel() {
    active.current?.abort();
    active.current = null;
    paused.current = false;
    continueReading.current = null;
  }
  function updateProgress(value?: AnkiImportProgress) {
    progress.current = value;
    setState({
      _tag: "reading",
      fileName: fileName.current,
      progress: value,
      paused: paused.current,
      draftSaved: draftSaved.current,
    });
  }
  function togglePause() {
    paused.current = !paused.current;
    updateProgress(progress.current);
    if (!paused.current) continueReading.current?.();
  }
  function draftUnavailable() {
    return draftSaved.current === false;
  }
  async function readFile(file: File): Promise<void> {
    cancel();
    if (file.size > MAX_ANKI_PACKAGE_BYTES) {
      setState({ _tag: "error", reason: "limits-exceeded" });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    fileName.current = file.name;
    draftSaved.current = undefined;
    updateProgress();
    const checkpoint = (value: AnkiImportProgress) =>
      Effect.gen(function* () {
        if (controller.signal.aborted || active.current !== controller) return;
        updateProgress(value);
        if (!paused.current) return;
        yield* Effect.async<undefined>((resume) => {
          continueReading.current = () => {
            continueReading.current = null;
            resume(Effect.succeed(undefined));
          };
          return Effect.sync(() => {
            continueReading.current = null;
          });
        });
      });
    const operation = Effect.gen(function* () {
      // Drafts contain untrusted source bytes, never an approved workspace mutation.
      if (persistDraft) {
        const saved = yield* Effect.either(saveAnkiDraft(file));
        draftSaved.current = Either.isRight(saved);
        updateProgress(progress.current);
      }
      const buffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: () => ({ _tag: "AnkiFileReadFailure" }) as const,
      });
      return yield* importAnkiApkg(
        new Uint8Array(buffer),
        {
          title: file.name
            .replace(/\.(?:apkg|colpkg)$/i, "")
            .replace(/[_-]+/g, " ")
            .trim()
            .slice(0, 80),
          color,
          now: new Date(),
          control: { checkpoint },
        },
        readSqlite,
      );
    });
    const result = await Effect.runPromise(Effect.either(operation), {
      signal: controller.signal,
    }).catch(() => null);
    if (controller.signal.aborted || active.current !== controller) return;
    active.current = null;
    if (result === null) {
      setState({ _tag: "error", reason: "read-failed" });
      return;
    }
    if (Either.isLeft(result)) {
      const error = result.left;
      setState({
        _tag: "error",
        reason: error._tag === "AnkiFileReadFailure" ? "read-failed" : error.reason,
      });
      return;
    }
    const proposal = draftUnavailable()
      ? {
          ...result.right,
          warnings: [
            ...(result.right.warnings ?? []),
            "The source package could not be saved for resume. Keep the original file to restart after closing the app.",
          ],
        }
      : result.right;
    setState({ _tag: "review", fileName: file.name, proposal });
  }
  return { readFile, cancel, togglePause };
}
