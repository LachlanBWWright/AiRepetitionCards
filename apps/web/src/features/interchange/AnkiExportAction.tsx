"use client";
import { useState } from "react";
import { Effect, Either } from "effect";
import { exportAnkiApkg } from "@recall/application";
import type { LearningArea, ReviewEvent } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { Button } from "@recall/ui-web/components/button";
import { writeAnkiSqliteInBrowser } from "./browser-anki-sqlite-writer";

export function AnkiExportAction({
  area,
  mediaStore,
  includeScheduling,
  reviewEvents,
  suspendedCardIds,
  disabled,
}: {
  readonly area: LearningArea | null;
  readonly mediaStore: MediaStore;
  readonly includeScheduling: boolean;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly suspendedCardIds?: readonly string[];
  readonly disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function run() {
    if (!area) return;
    setBusy(true);
    setStatus("");
    const result = await Effect.runPromise(
      Effect.either(
        exportAnkiApkg(area, mediaStore, writeAnkiSqliteInBrowser, {
          now: new Date(),
          includeScheduling,
          ...(reviewEvents ? { reviewEvents } : {}),
          ...(suspendedCardIds ? { suspendedCardIds } : {}),
        }),
      ),
    );
    if (Either.isRight(result)) {
      const buffer = new ArrayBuffer(result.right.length);
      new Uint8Array(buffer).set(result.right);
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${area.title.replace(/[^a-z0-9]+/gi, "-")}.apkg`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(
        includeScheduling
          ? "Anki package downloaded with private scheduling and answer history."
          : "Anki package downloaded with new-card schedules.",
      );
    } else setStatus(`Anki export failed: ${result.left.reason}.`);
    setBusy(false);
  }
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={busy || disabled || !area}
        onClick={() => void run()}
      >
        {busy ? "Preparing Anki…" : "Export Anki .apkg"}
      </Button>
      <p className="mt-2 text-xs text-recall-muted">
        Anki files include text templates and attachments. Actual answer history is included when
        private history is selected. Use Recall ZIP to retain rich formatting, image masks and
        answer/speech preferences.
      </p>
      {status && (
        <p className="mt-2 text-sm text-recall-muted" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
