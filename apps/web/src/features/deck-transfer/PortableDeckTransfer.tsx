"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Effect, Either, Schema } from "effect";
import {
  KnowledgeAreaSchema,
  type KnowledgeArea,
  type LearningArea,
  type Workspace,
} from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import {
  exportPortableDeckPackage,
  importPortableDeckPackage,
  toKnowledgeArea,
  type ImportedPortableDeckPackage,
} from "@recall/application";
import { Button } from "@recall/ui-web/components/button";

export type PortableDeckTransferProps = {
  readonly area: LearningArea | null;
  readonly workspace: Workspace;
  readonly mediaStore: MediaStore;
  readonly onImport: (
    preview: ImportedPortableDeckPackage,
    restorePrivateHistory: boolean,
  ) => Promise<boolean>;
  readonly disabled?: boolean;
};

export function PortableDeckTransfer({
  area,
  workspace,
  mediaStore,
  onImport,
  disabled = false,
}: PortableDeckTransferProps) {
  const picker = useRef<HTMLInputElement>(null);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [restorePrivate, setRestorePrivate] = useState(false);
  function handleRestorePrivateChange(event: ChangeEvent<HTMLInputElement>) {
    setRestorePrivate(event.currentTarget.checked);
  }
  const [preview, setPreview] = useState<{
    readonly filename: string;
    readonly value: ImportedPortableDeckPackage;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prepareArea = (): KnowledgeArea | null => {
    if (!area) return null;
    const decoded = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
    if (Either.isLeft(decoded)) return null;
    const exported = decoded.right;
    const activityLibrary = workspace.activityLibrary;
    const withActivities = activityLibrary
      ? {
          ...exported,
          activities: activityLibrary.activities.filter(
            (item) => item.areaId === area.id && !item.archived,
          ),
        }
      : exported;
    const validated = Schema.decodeUnknownEither(KnowledgeAreaSchema)(withActivities);
    if (Either.isLeft(validated)) return null;
    return validated.right;
  };

  const exportDeck = async () => {
    setBusy(true);
    setStatus("");
    if (!area) {
      setBusy(false);
      return;
    }
    const selectedArea = area;
    try {
      const document = prepareArea();
      if (!document) {
        setStatus("This deck cannot be packaged yet.");
        return;
      }
      const history = includePrivate
        ? {
            currentArea: selectedArea,
            reviewEvents: (workspace.reviewEvents ?? []).filter(
              (event) => event.areaId === selectedArea.id,
            ),
            cardVersions: (workspace.cardVersions ?? []).filter(
              (version) => version.areaId === selectedArea.id,
            ),
            ...(workspace.activityLibrary ? { activityLibrary: workspace.activityLibrary } : {}),
          }
        : undefined;
      const result = await Effect.runPromise(
        Effect.either(exportPortableDeckPackage(document, mediaStore, history)),
      );
      if (Either.isLeft(result)) {
        setStatus("Could not export this deck. Check that all media is available.");
        return;
      }
      const slug =
        selectedArea.title
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || "deck";
      const link = window.document.createElement("a");
      const buffer = new ArrayBuffer(result.right.byteLength);
      new Uint8Array(buffer).set(result.right);
      link.href = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
      link.download = `${slug}${includePrivate ? ".private" : ""}.recall-deck.zip`;
      window.document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setStatus(
        includePrivate
          ? "Private single-deck copy downloaded. Handle this file as private study data."
          : "Public-safe deck package downloaded.",
      );
    } catch (error) {
      if (mounted.current)
        setStatus(error instanceof Error ? error.message : "Could not export this deck.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    setPreview(null);
    setStatus("");
    if (!file) return;
    if (file.size > 25_000_000) {
      if (mounted.current) setStatus("This file is larger than the 25 MB deck package limit.");
      return;
    }
    setBusy(true);
    try {
      const result = await Effect.runPromise(
        Effect.either(importPortableDeckPackage(new Uint8Array(await file.arrayBuffer()))),
      );
      if (Either.isLeft(result)) {
        setStatus("This file is not a valid Recall deck package.");
        return;
      }
      if (mounted.current) {
        setPreview({ filename: file.name, value: result.right });
        setRestorePrivate(false);
      }
    } catch {
      if (mounted.current) setStatus("This file is not a valid Recall deck package.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const approve = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const applied = await onImport(preview.value, restorePrivate);
      if (!mounted.current) return;
      if (applied) {
        setStatus(`Imported ${preview.value.knowledgeArea.title} as a personal copy.`);
        setPreview(null);
        if (picker.current) picker.current.value = "";
      }
    } catch {
      if (mounted.current)
        setStatus("Import could not be completed. Your current deck was left unchanged.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-recall-line bg-recall-surface p-4"
      aria-label="Portable deck transfer"
    >
      <h3 className="text-base font-semibold text-recall-ink">Portable deck file</h3>
      <p className="mt-1 text-sm text-recall-muted">
        Move one deck with its definitions and media. Private study data is excluded unless you
        choose it.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm text-recall-ink">
        <input
          type="checkbox"
          checked={includePrivate}
          onChange={(event) => {
            setIncludePrivate(event.currentTarget.checked);
          }}
        />
        Include private history for current cards, saved schedules, activity attempts and drafts.
        Deleted-card history stays in a full workspace backup.
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void exportDeck()}
          disabled={busy || disabled || !area}
        >
          {busy ? "Working…" : "Export deck ZIP"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => picker.current?.click()}
          disabled={busy || disabled}
        >
          Choose deck ZIP
        </Button>
        <input
          ref={picker}
          className="sr-only"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => void readFile(event.currentTarget.files?.[0])}
        />
      </div>
      {preview ? (
        <div className="mt-4 rounded-lg border border-recall-line p-3" aria-live="polite">
          <p className="font-medium text-recall-ink">Review import: {preview.filename}</p>
          <p className="mt-1 text-sm text-recall-muted">
            {preview.value.knowledgeArea.title} · {preview.value.knowledgeArea.cards.length} cards ·{" "}
            {preview.value.knowledgeArea.objectives.length} objectives ·{" "}
            {(preview.value.knowledgeArea.activities ?? []).length} activities ·{" "}
            {preview.value.media.length} media files
          </p>
          <p className="mt-1 text-sm text-recall-muted">
            Package type:{" "}
            {preview.value.privacy === "private"
              ? "private single-deck copy"
              : "public-safe content"}
            . It will be imported as a personal copy.
          </p>
          {preview.value.privacy === "private" ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-recall-ink">
              <input
                type="checkbox"
                checked={restorePrivate}
                onChange={handleRestorePrivateChange}
              />
              Restore private history and saved schedules. This is only allowed when all original
              deck/history IDs are unused here.
            </label>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button type="button" onClick={() => void approve()} disabled={busy || disabled}>
              {restorePrivate ? "Restore private copy" : "Import personal copy"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreview(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p className="mt-3 text-sm text-recall-muted" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
