"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  MediaReferenceSchema,
  parseKnowledgeAreaJson,
  parseWorkspaceJson,
  type MediaReference,
} from "@recall/domain";
import { newSchedule, rebuildSchedule, type ReviewRating } from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import {
  clearWorkspace,
  exportDelimitedCards,
  exportKnowledgeAreaPackage,
  importDelimitedCards,
  importKnowledgeAreaPackage,
  isSupportedMediaContent,
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
  persistMediaAssets,
  loadWorkspace,
  recordReview,
  saveWorkspace,
} from "@recall/application";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { type LearningArea, type StudyCard, type Workspace } from "@/features/workspace/types";
import { fromKnowledgeArea, toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { Button } from "@/components/ui/Button";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AccountAction } from "@/components/auth/AccountAction";
import { WorkspaceSyncAction } from "@/components/auth/WorkspaceSyncAction";
import {
  prepareWorkspaceForSync,
  repairReviewSyncConflicts,
} from "@/features/workspace/sync-outbox";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { TutorPanel } from "@/components/tutor/TutorPanel";
import { identifyObjectiveGaps, type CardProposal } from "@recall/ai-core";
import { KnowledgeAreaPublishing } from "@/components/publishing/KnowledgeAreaPublishing";

const colors = ["#c4ed68", "#ffb29b", "#c4b5fd", "#f7cb70"];
const starter: Workspace = { ...mockWorkspace, reviews: 0, reviewEvents: [] };

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function dueNow(card: StudyCard, now: Date): boolean {
  return new Date(card.schedule.due).getTime() <= now.getTime();
}

function MediaFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setUrl(reader.result);
    };
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  if (!url) return null;
  return file.type.startsWith("image/") ? (
    <Image
      className="card-media-preview"
      src={url}
      alt="Selected card attachment preview"
      width={320}
      height={180}
      unoptimized
    />
  ) : (
    <audio controls src={url} aria-label="Selected audio preview" />
  );
}

type StoryDemo = {
  workspace: Workspace;
  view?: string;
  selectedAreaId?: string;
  editAreaId?: string;
  showAnswer?: boolean;
  addCard?: boolean;
  mockMediaPreviews?: readonly { readonly mimeType: string; readonly url: string }[];
};

export default function Home({ demo }: { demo?: StoryDemo }) {
  const demoArea = demo?.workspace.areas.find((item) => item.id === demo.editAreaId);
  const [workspace, setWorkspace] = useState<Workspace>(
    demo?.workspace ?? { ...starter, reviewEvents: [] },
  );
  const [ready, setReady] = useState(false);
  const [cacheWritable, setCacheWritable] = useState(false);
  const [cacheBlocked, setCacheBlocked] = useState(false);
  const [selectedId, setSelectedId] = useState(
    demo?.selectedAreaId ?? demo?.editAreaId ?? "area-biology",
  );
  const [showAnswer, setShowAnswer] = useState(demo?.showAnswer ?? false);
  const [addingArea, setAddingArea] = useState(Boolean(demo?.editAreaId));
  const [editingAreaId, setEditingAreaId] = useState<string | null>(demo?.editAreaId ?? null);
  const [areaColor, setAreaColor] = useState(demoArea?.color ?? colors[0] ?? "#c4ed68");
  const [addingCard, setAddingCard] = useState(Boolean(demo?.addCard));
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [areaTitle, setAreaTitle] = useState(demoArea?.title ?? "");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviews, setMediaPreviews] = useState<
    readonly { readonly mimeType: string; readonly url: string }[]
  >(() => demo?.mockMediaPreviews ?? []);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState(demo?.view ?? "Today");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (demo) {
      const hydration = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(hydration);
    }
    let active = true;
    void Effect.runPromise(Effect.either(loadWorkspace(browserWorkspaceStore))).then(
      (loadResult) => {
        if (!active) return;
        let loaded: Workspace = starter;
        let canWriteCache = true;
        let cacheProblem: string | null = null;
        if (Either.isLeft(loadResult)) {
          canWriteCache = false;
          cacheProblem = "Saved data could not be read. Changes will stay in this session.";
        } else if (loadResult.right._tag === "Loaded") {
          loaded = loadResult.right.workspace;
        } else if (loadResult.right._tag === "Invalid") {
          canWriteCache = false;
          cacheProblem =
            loadResult.right.reason === "unsupported-version"
              ? "Saved data uses a newer Recall format. It has been left untouched."
              : "Saved data could not be decoded and has been left untouched.";
        }
        setWorkspace(prepareWorkspaceForSync(loaded, () => crypto.randomUUID()));
        setCacheWritable(canWriteCache);
        setCacheBlocked(!canWriteCache);
        setImportNotice(cacheProblem);
        setReady(true);
      },
    );
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [demo]);

  useEffect(() => {
    if (ready && !demo && cacheWritable) {
      void Effect.runPromise(Effect.either(saveWorkspace(browserWorkspaceStore, workspace))).then(
        (result) => {
          if (Either.isLeft(result)) {
            setCacheWritable(false);
            setCacheBlocked(true);
            setImportNotice(
              "Workspace storage could not save changes. They will stay in this session.",
            );
          }
        },
      );
    }
  }, [cacheWritable, demo, ready, workspace]);

  async function discardSavedWorkspace() {
    const result = await Effect.runPromise(Effect.either(clearWorkspace(browserWorkspaceStore)));
    if (Either.isLeft(result)) {
      setImportNotice("Workspace storage could not be cleared. Saved data was left untouched.");
      return;
    }
    setWorkspace(starter);
    setCacheWritable(true);
    setCacheBlocked(false);
    setImportNotice("Saved data was cleared. This device is ready for a fresh workspace.");
  }

  const area = workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0];
  const tutorAreaDocument = area ? Effect.runSync(Effect.either(toKnowledgeArea(area))) : null;
  const allCards = workspace.areas.flatMap((item) => item.cards);
  const dueCount = allCards.filter((card) => dueNow(card, now)).length;
  const card = area?.cards.find((item) => dueNow(item, now));
  useEffect(() => {
    if (demo?.mockMediaPreviews?.length) return;
    let active = true;
    const urls: string[] = [];
    const references = card?.media ?? [];
    void Effect.runPromise(
      Effect.either(Effect.forEach(references, (reference) => browserMediaStore.get(reference.id))),
    ).then((result) => {
      if (Either.isLeft(result)) return;
      const previews = result.right.flatMap((asset) => {
        if (!asset) return [];
        const copy = new Uint8Array(asset.bytes.byteLength);
        copy.set(asset.bytes);
        const contentId = Array.from(sha256(copy), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (
          contentId !== asset.reference.id ||
          !isSupportedMediaContent(copy, asset.reference.mimeType)
        )
          return [];
        const url = URL.createObjectURL(
          new Blob([copy.buffer], { type: asset.reference.mimeType }),
        );
        urls.push(url);
        return [{ mimeType: asset.reference.mimeType, url }];
      });
      if (active) setMediaPreviews(previews);
      else urls.forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [card?.id, card?.media, demo?.mockMediaPreviews]);
  const studiedToday = workspace.reviews;
  const areaDue = area?.cards.filter((item) => dueNow(item, now)).length ?? 0;
  const objectiveGaps = useMemo(
    () => (area ? identifyObjectiveGaps(area, workspace.reviewEvents ?? [], now) : []),
    [area, now, workspace.reviewEvents],
  );
  const progress = useMemo(
    () =>
      allCards.length === 0
        ? 0
        : Math.round(((allCards.length - dueCount) / allCards.length) * 100),
    [allCards.length, dueCount],
  );
  const reviewHistory = useMemo(() => {
    const events = workspace.reviewEvents ?? [];
    const { concurrentEventIds } = orderReviewEvents(events);
    return [...events]
      .sort((left, right) => right.ratedAt.localeCompare(left.ratedAt))
      .slice(0, 20)
      .map((event) => ({
        ...event,
        hasConcurrentBranch: concurrentEventIds.has(event.id),
        needsSyncRetry: (workspace.reviewConflictIds ?? []).includes(event.id),
        areaTitle:
          workspace.areas.find((item) => item.id === event.areaId)?.title ?? "Removed area",
        question:
          workspace.areas
            .find((item) => item.id === event.areaId)
            ?.cards.find((item) => item.id === event.cardId)?.front ?? "Removed card",
      }));
  }, [workspace.areas, workspace.reviewEvents, workspace.reviewConflictIds]);

  function review(rating: ReviewRating) {
    if (!area || !card) return;
    const transition = Effect.runSync(
      Effect.either(
        recordReview({
          workspace,
          areaId: area.id,
          cardId: card.id,
          rating,
          eventId: crypto.randomUUID(),
          ratedAt: new Date().toISOString(),
        }),
      ),
    );
    if (Either.isLeft(transition)) {
      setImportNotice("This review could not be recorded. Your study history was left unchanged.");
      return;
    }
    setWorkspace(transition.right.workspace);
    setShowAnswer(false);
    setNow(new Date());
  }

  function createArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = areaTitle.trim();
    if (!title) return;
    const editingArea = workspace.areas.find((item) => item.id === editingAreaId);
    if (editingArea) {
      setWorkspace((current) => ({
        ...current,
        areas: current.areas.map((item) =>
          item.id === editingArea.id ? { ...item, title, color: areaColor } : item,
        ),
      }));
      setAreaTitle("");
      setEditingAreaId(null);
      setAddingArea(false);
      setImportNotice(`${title} updated.`);
      return;
    }
    const created: LearningArea = {
      id: crypto.randomUUID(),
      title,
      color: areaColor,
      cards: [],
    };
    setWorkspace((current) => ({ ...current, areas: [...current.areas, created] }));
    setSelectedId(created.id);
    setAreaTitle("");
    setAreaColor(colors[(workspace.areas.length + 1) % colors.length] ?? colors[0] ?? "#c4ed68");
    setAddingArea(false);
  }

  function editArea(target: LearningArea) {
    setEditingAreaId(target.id);
    setAreaTitle(target.title);
    setAreaColor(target.color);
    setAddingArea(true);
  }

  function closeAreaEditor() {
    setAddingArea(false);
    setEditingAreaId(null);
  }

  function deleteArea(target: LearningArea) {
    if (!window.confirm(`Delete “${target.title}”? Its review history will remain on this device.`))
      return;
    const baseContentHash = workspace.syncContentHashes?.[target.id];
    setWorkspace((current) => ({
      ...current,
      areas: current.areas.filter((item) => item.id !== target.id),
      deletedCards: (current.deletedCards ?? []).filter((item) => item.areaId !== target.id),
      deletedAreas: baseContentHash
        ? [
            ...(current.deletedAreas ?? []).filter((item) => item.areaId !== target.id),
            { areaId: target.id, baseContentHash },
          ]
        : current.deletedAreas,
    }));
    if (selectedId === target.id) {
      const replacement = workspace.areas.find((item) => item.id !== target.id);
      setSelectedId(replacement?.id ?? "");
    }
    setShowAnswer(false);
    setImportNotice(
      baseContentHash
        ? `${target.title} was removed. Sync to remove it from your other devices.`
        : `${target.title} was removed from this device. Its review history remains saved.`,
    );
  }

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!area || !front.trim() || !back.trim()) return;
    const existing = area.cards.find((item) => item.id === editingCardId);
    const media = [...(existing?.media ?? [])];
    if (mediaFile) {
      if (mediaFile.size < 1 || mediaFile.size > 20_000_000) {
        setImportNotice("Media must be smaller than 20 MB.");
        return;
      }
      const mimeType = mediaFile.type;
      const readAndStore: Effect.Effect<
        MediaReference,
        { readonly _tag: "MediaAttachmentFailure" },
        never
      > = Effect.tryPromise({
        try: () => mediaFile.arrayBuffer(),
        catch: () => ({ _tag: "MediaAttachmentFailure" }) as const,
      }).pipe(
        Effect.flatMap((buffer) => {
          const bytes = new Uint8Array(buffer);
          const id = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          );
          const decoded = Schema.decodeUnknownEither(MediaReferenceSchema)({
            id,
            mimeType,
            byteLength: bytes.byteLength,
          });
          if (Either.isLeft(decoded) || !isSupportedMediaContent(bytes, decoded.right.mimeType))
            return Effect.fail({ _tag: "MediaAttachmentFailure" } as const);
          return browserMediaStore.put({ reference: decoded.right, bytes }).pipe(
            Effect.map(() => decoded.right),
            Effect.mapError(() => ({ _tag: "MediaAttachmentFailure" }) as const),
          );
        }),
        Effect.mapError(() => ({ _tag: "MediaAttachmentFailure" }) as const),
      );
      const result = await Effect.runPromise(Effect.either(readAndStore));
      if (Either.isLeft(result)) {
        setImportNotice("Choose a supported image or audio file that can be saved locally.");
        return;
      }
      if (!media.some((reference) => reference.id === result.right.id)) media.push(result.right);
    }
    const created: StudyCard = existing
      ? { ...existing, front: front.trim(), back: back.trim(), ...(media.length ? { media } : {}) }
      : {
          id: crypto.randomUUID(),
          front: front.trim(),
          back: back.trim(),
          objective: "My learning goals",
          schedule: newSchedule(),
          ...(media.length ? { media } : {}),
        };
    setWorkspace((current) => ({
      ...current,
      areas: current.areas.map((item) =>
        item.id === area.id
          ? {
              ...item,
              cards: existing
                ? item.cards.map((candidate) =>
                    candidate.id === existing.id ? created : candidate,
                  )
                : [...item.cards, created],
            }
          : item,
      ),
    }));
    setFront("");
    setBack("");
    setMediaFile(null);
    setAddingCard(false);
    setEditingCardId(null);
    setShowAnswer(false);
  }

  function editCard(target: StudyCard) {
    setEditingCardId(target.id);
    setFront(target.front);
    setBack(target.back);
    setMediaFile(null);
    setAddingCard(true);
  }

  function deleteCard(target: StudyCard) {
    if (!area || !window.confirm("Delete this study card? Its review history will remain.")) return;
    setWorkspace((current) => ({
      ...current,
      deletedCards: [
        ...(current.deletedCards ?? []).filter((item) => item.cardId !== target.id),
        { areaId: area.id, cardId: target.id },
      ],
      areas: current.areas.map((item) =>
        item.id === area.id
          ? { ...item, cards: item.cards.filter((candidate) => candidate.id !== target.id) }
          : item,
      ),
    }));
    setShowAnswer(false);
  }

  function exportArea() {
    if (!area) return;
    const document = Effect.runSync(Effect.either(toKnowledgeArea(area)));
    if (Either.isLeft(document)) {
      setImportNotice(
        document.left.reason === "media-requires-package"
          ? "Use Export ZIP to include this area’s attached media."
          : "This learning area could not be exported because its content is invalid.",
      );
      return;
    }
    const blob = new Blob([JSON.stringify(document.right, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = objectUrl;
    link.download = `${area.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.knowledge-area.json`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    setImportNotice(`${area.title} exported. Personal reviews and schedules stay on this device.`);
  }

  async function exportAreaPackage() {
    if (!area) return;
    const result = await Effect.runPromise(
      Effect.either(
        Effect.flatMap(toKnowledgeArea(area, false, true), (document) =>
          exportKnowledgeAreaPackage(document, browserMediaStore),
        ),
      ),
    );
    if (Either.isLeft(result)) {
      setImportNotice("The package could not be exported. Check that all card media is saved.");
      return;
    }
    const zipBuffer = new ArrayBuffer(result.right.byteLength);
    new Uint8Array(zipBuffer).set(result.right);
    const blob = new Blob([zipBuffer], { type: "application/zip" });
    const objectUrl = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = objectUrl;
    link.download = `${area.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.knowledge-area.zip`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    setImportNotice(`${area.title} media package exported without personal review history.`);
  }

  function exportDelimited(delimiter: "," | "\t") {
    if (!area) return;
    const isTsv = delimiter === "\t";
    const extension = isTsv ? "tsv" : "csv";
    downloadText(
      `${area.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${extension}`,
      exportDelimitedCards(area, delimiter),
      isTsv ? "text/tab-separated-values;charset=utf-8" : "text/csv;charset=utf-8",
    );
    setImportNotice(`${area.title} exported as ${extension.toUpperCase()}.`);
  }

  async function exportWorkspaceBackup() {
    const result = await Effect.runPromise(
      Effect.either(
        exportWorkspaceBackupPackage(workspace, new Date().toISOString(), browserMediaStore),
      ),
    );
    if (Either.isLeft(result)) {
      setImportNotice(
        "The private backup could not be created. Check that all attachments are saved.",
      );
      return;
    }
    const buffer = new ArrayBuffer(result.right.byteLength);
    new Uint8Array(buffer).set(result.right);
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
    const link = window.document.createElement("a");
    link.href = objectUrl;
    link.download = "recall-workspace-backup.zip";
    link.click();
    URL.revokeObjectURL(objectUrl);
    setImportNotice("Private backup exported with review history, schedules, and attached media.");
  }

  async function restoreWorkspaceBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 100_000_000) {
      setImportNotice("Workspace backup packages must be 100 MB or smaller.");
      return;
    }
    if (file.name.toLowerCase().endsWith(".zip")) {
      const imported = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => file.arrayBuffer(),
            catch: () => ({ _tag: "WorkspaceBackupReadFailure" }) as const,
          }).pipe(Effect.flatMap((buffer) => importWorkspaceBackupPackage(new Uint8Array(buffer)))),
        ),
      );
      if (Either.isLeft(imported)) {
        setImportNotice("That private backup is invalid, too large, or has missing media.");
        return;
      }
      if (!window.confirm("Replace this device’s current workspace with the selected backup?"))
        return;
      const stored = await Effect.runPromise(
        Effect.either(persistMediaAssets(browserMediaStore, imported.right.media)),
      );
      if (Either.isLeft(stored)) {
        setImportNotice("Backup media could not be restored; the workspace was left unchanged.");
        return;
      }
      const prepared = prepareWorkspaceForSync(imported.right.workspace, () => crypto.randomUUID());
      setWorkspace(prepared);
      setSelectedId(prepared.areas[0]?.id ?? "");
      setShowAnswer(false);
      setActiveView("Today");
      setImportNotice("Private backup restored with review history, schedules, and media.");
      return;
    }
    if (file.size > 10_000_000) {
      setImportNotice("Legacy JSON workspace backups must be 10 MB or smaller.");
      return;
    }
    const fileText = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => file.text(),
          catch: () => ({ _tag: "WorkspaceBackupReadError" }) as const,
        }),
      ),
    );
    if (Either.isLeft(fileText)) {
      setImportNotice("The workspace backup could not be read.");
      return;
    }
    const parsed = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => JSON.parse(fileText.right) as unknown,
          catch: () => ({ _tag: "WorkspaceBackupParseError" }) as const,
        }),
      ),
    );
    if (Either.isLeft(parsed)) {
      setImportNotice("That file is not a valid Recall workspace backup.");
      return;
    }
    const backup = Schema.decodeUnknownEither(
      Schema.Struct({
        backupVersion: Schema.Literal(1),
        exportedAt: Schema.String,
        workspace: Schema.Unknown,
      }),
    )(parsed.right);
    if (
      Either.isLeft(backup) ||
      typeof backup.right.workspace !== "object" ||
      backup.right.workspace === null
    ) {
      setImportNotice("That file is not a valid Recall workspace backup.");
      return;
    }
    const restoredResult = Effect.runSync(
      Effect.either(parseWorkspaceJson(JSON.stringify(backup.right.workspace) ?? "")),
    );
    if (Either.isLeft(restoredResult)) {
      setImportNotice("The backup contains invalid or unsupported workspace data.");
      return;
    }
    if (
      restoredResult.right.areas.some((item) =>
        item.cards.some((studyCard) => (studyCard.media?.length ?? 0) > 0),
      )
    ) {
      setImportNotice(
        "This legacy JSON backup references media without including it; restore a ZIP backup.",
      );
      return;
    }
    if (!window.confirm("Replace this device’s current workspace with the selected backup?"))
      return;
    const prepared = prepareWorkspaceForSync(restoredResult.right, () => crypto.randomUUID());
    setWorkspace(prepared);
    setSelectedId(prepared.areas[0]?.id ?? "");
    setShowAnswer(false);
    setActiveView("Today");
    setImportNotice("Private workspace backup restored on this device.");
  }

  function importDelimited(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setImportNotice("CSV and TSV files must be 2 MB or smaller.");
      return;
    }
    const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const title = file.name
      .replace(/\.(csv|tsv)$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    const program = Effect.tryPromise({
      try: () => file.text(),
      catch: () => ({ _tag: "DelimitedImportReadError" }) as const,
    }).pipe(
      Effect.map((text) =>
        importDelimitedCards(
          text,
          delimiter,
          title,
          colors[workspace.areas.length % colors.length] ?? "#c4ed68",
        ),
      ),
      Effect.match({
        onFailure: () => setImportNotice("The selected file could not be read."),
        onSuccess: (result) => {
          if (result._tag === "Failure") {
            const messages = {
              "invalid-quote": "The CSV/TSV has invalid quoted fields.",
              "too-many-rows": "CSV/TSV imports are limited to 10,000 card rows.",
              "too-many-columns": "CSV/TSV imports are limited to 30 columns.",
              "field-too-large": "CSV/TSV fields are limited to 1 MB.",
              "input-too-large": "CSV/TSV imports are limited to 2 MB.",
              "missing-front-back":
                "Include front and back columns, or use two columns without a header.",
              "no-cards": "No non-empty front/back card rows were found.",
            } as const;
            setImportNotice(messages[result.reason]);
            return;
          }
          setWorkspace((current) => ({ ...current, areas: [...current.areas, result.area] }));
          setSelectedId(result.area.id);
          setActiveView("Today");
          setImportNotice(`${result.area.cards.length} cards imported from ${file.name}.`);
        },
      }),
    );
    Effect.runFork(program);
  }

  function importArea(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setImportNotice("Knowledge Area JSON files must be 2 MB or smaller.");
      return;
    }

    const program = Effect.tryPromise({
      try: () => file.text(),
      catch: () => ({ _tag: "KnowledgeAreaImportError", reason: "file-read-failed" }) as const,
    }).pipe(
      Effect.flatMap(parseKnowledgeAreaJson),
      Effect.flatMap((document) =>
        document.cards.some((item) => (item.media?.length ?? 0) > 0)
          ? Effect.fail({
              _tag: "KnowledgeAreaImportError",
              reason: "media-requires-package",
            } as const)
          : Effect.succeed(document),
      ),
      Effect.flatMap((document) =>
        fromKnowledgeArea(
          document,
          colors[workspace.areas.length % colors.length] ?? "#c4ed68",
          false,
          () => crypto.randomUUID(),
        ),
      ),
      Effect.match({
        onFailure: (error) => {
          const message =
            error.reason === "media-requires-package"
              ? "This file references media. Import its ZIP package so the attachments can be verified."
              : error.reason === "unsupported-card-type"
                ? "This file contains cloze cards; this client currently imports basic cards."
                : error.reason === "unknown-reference"
                  ? "The file refers to a learning objective that is missing."
                  : error.reason === "duplicate-id"
                    ? "The file contains duplicate IDs."
                    : "That file is not a valid Knowledge Area JSON document.";
          setImportNotice(message);
        },
        onSuccess: (imported) => {
          setWorkspace((current) => ({ ...current, areas: [...current.areas, imported] }));
          setSelectedId(imported.id);
          setActiveView("Today");
          setShowAnswer(false);
          setImportNotice(
            `${imported.title} imported. Review schedules were initialized for this learner.`,
          );
        },
      }),
    );
    Effect.runFork(program);
  }

  function importAreaPackage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const program = Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: () => ({ _tag: "PackageReadFailure" }) as const,
    }).pipe(
      Effect.flatMap((buffer) => importKnowledgeAreaPackage(new Uint8Array(buffer))),
      Effect.flatMap((pack) =>
        fromKnowledgeArea(
          pack.knowledgeArea,
          colors[workspace.areas.length % colors.length] ?? "#c4ed68",
          false,
          () => crypto.randomUUID(),
          true,
        ).pipe(Effect.map((importedArea) => ({ importedArea, media: pack.media }))),
      ),
      Effect.flatMap(({ importedArea, media }) =>
        persistMediaAssets(browserMediaStore, media).pipe(Effect.map(() => importedArea)),
      ),
      Effect.match({
        onFailure: () =>
          setImportNotice("That ZIP is invalid, too large, or contains unsupported media."),
        onSuccess: (imported) => {
          setWorkspace((current) => ({ ...current, areas: [...current.areas, imported] }));
          setSelectedId(imported.id);
          setActiveView("Today");
          setShowAnswer(false);
          setImportNotice(`${imported.title} and its verified media were imported.`);
        },
      }),
    );
    Effect.runFork(program);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#today">
          <span className="brand-mark">r</span>
          <span>
            recall<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">
          YOUR WORKSPACE <span className="workspace-avatar">L</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {["Today", "Explore", "Insights"].map((label, index) => (
            <button
              key={label}
              className={`nav-item ${activeView === label ? "active" : ""}`}
              onClick={() => setActiveView(label)}
            >
              <span className="nav-icon">{["◷", "▤", "↗"][index]}</span>
              {label}
              {label === "Today" && <span className="nav-count">{dueCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="section-heading">
            YOUR LEARNING AREAS{" "}
            <button
              className="icon-button"
              aria-label="Add learning area"
              onClick={() => setAddingArea(true)}
            >
              ＋
            </button>
          </div>
          {workspace.areas.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setShowAnswer(false);
                setActiveView("Today");
              }}
              className={`area-link ${selectedId === item.id ? "selected" : ""}`}
            >
              <span className="area-dot" style={{ backgroundColor: item.color }} />
              {item.title}
              <span className="area-count">
                {item.cards.filter((entry) => dueNow(entry, now)).length}
              </span>
            </button>
          ))}
          <button
            className="add-area"
            onClick={() => {
              setEditingAreaId(null);
              setAreaTitle("");
              setAreaColor(
                colors[workspace.areas.length % colors.length] ?? colors[0] ?? "#c4ed68",
              );
              setAddingArea(true);
            }}
          >
            ＋ Add a learning area
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="streak-card">
            <span className="streak-icon">✳</span>
            <div>
              <strong>Keep your rhythm</strong>
              <p>A little practice goes a long way.</p>
            </div>
          </div>
          <button className="profile">
            <span className="profile-avatar">L</span>
            <span>
              <strong>Learner</strong>
              <small>Personal workspace</small>
            </span>
            <span className="profile-more">···</span>
          </button>
        </div>
      </aside>

      <section className="main-content" id="today">
        <header className="topbar">
          <div className="breadcrumb">
            My learning <span>/</span> <strong>{activeView}</strong>
          </div>
          <div className="top-actions">
            <AccountAction demo={Boolean(demo)} workspace={workspace} />
            <WorkspaceSyncAction
              demo={Boolean(demo)}
              workspace={workspace}
              onSynced={(
                acceptedIds,
                cursor,
                pulledEvents,
                pulledAreas,
                deletedCardIds,
                syncedAreaTombstoneIds,
                pulledDeletedAreaIds,
                contentHashes,
                conflicts,
              ) => {
                const accepted = new Set(acceptedIds);
                setWorkspace((current) => {
                  const repaired = repairReviewSyncConflicts(current, conflicts, () =>
                    crypto.randomUUID(),
                  );
                  const events = new Map(
                    (repaired.reviewEvents ?? []).map((event) => [event.id, event]),
                  );
                  for (const event of pulledEvents) {
                    if (!events.has(event.id)) events.set(event.id, event);
                  }
                  const allEvents = [...events.values()];
                  const localAreas = new Map(repaired.areas.map((area) => [area.id, area]));
                  const deletedCards = new Set([
                    ...(repaired.deletedCards ?? []).map((item) => item.cardId),
                    ...deletedCardIds,
                  ]);
                  const syncedAreas = pulledAreas.map((remoteArea) => {
                    const localArea = localAreas.get(remoteArea.id);
                    const localCards = new Map(localArea?.cards.map((card) => [card.id, card]));
                    return {
                      ...remoteArea,
                      ...(localArea?.sourceId ? { sourceId: localArea.sourceId } : {}),
                      cards: remoteArea.cards
                        .filter((card) => !deletedCards.has(card.id))
                        .map((remoteCard) => {
                          const localCard = localCards.get(remoteCard.id);
                          return localCard
                            ? {
                                ...remoteCard,
                                sourceId: localCard.sourceId,
                                schedule: localCard.schedule,
                              }
                            : remoteCard;
                        }),
                    };
                  });
                  const mergedDeletedCards = new Map(
                    (repaired.deletedCards ?? []).map((item) => [item.cardId, item]),
                  );
                  for (const cardId of deletedCardIds) {
                    if (mergedDeletedCards.has(cardId)) continue;
                    const areaId = repaired.areas.find((area) =>
                      area.cards.some((card) => card.id === cardId),
                    )?.id;
                    if (areaId) mergedDeletedCards.set(cardId, { areaId, cardId });
                  }
                  const areaTombstones = new Map(
                    (repaired.deletedAreas ?? []).map((item) => [item.areaId, item]),
                  );
                  for (const areaId of syncedAreaTombstoneIds) {
                    const existing = areaTombstones.get(areaId);
                    if (existing) areaTombstones.set(areaId, { ...existing, synced: true });
                  }
                  for (const areaId of pulledDeletedAreaIds) {
                    areaTombstones.set(areaId, {
                      areaId,
                      ...(repaired.syncContentHashes?.[areaId]
                        ? { baseContentHash: repaired.syncContentHashes[areaId] }
                        : {}),
                      synced: true,
                    });
                  }
                  return {
                    ...repaired,
                    reviewEvents: allEvents,
                    syncContentHashes: { ...(repaired.syncContentHashes ?? {}), ...contentHashes },
                    deletedCards: [...mergedDeletedCards.values()],
                    deletedAreas: [...areaTombstones.values()],
                    reviews: Math.max(repaired.reviews, allEvents.length),
                    areas: syncedAreas
                      .map((area) => ({
                        ...area,
                        cards: area.cards.map((card) => {
                          const cardEvents = allEvents.filter((event) => event.cardId === card.id);
                          return cardEvents.length > 0
                            ? { ...card, schedule: rebuildSchedule(cardEvents) }
                            : card;
                        }),
                      }))
                      .filter((area) => !areaTombstones.has(area.id)),
                    pendingReviewEventIds: (repaired.pendingReviewEventIds ?? []).filter(
                      (id) => !accepted.has(id),
                    ),
                    reviewConflictIds: (repaired.reviewConflictIds ?? []).filter(
                      (id) => !accepted.has(id),
                    ),
                    syncCursor: cursor,
                  };
                });
              }}
              onContentConflict={(remoteAreas, contentHashes, deletedAreaIds) => {
                setWorkspace((current) => {
                  const localById = new Map(current.areas.map((area) => [area.id, area]));
                  const remoteIds = new Set(remoteAreas.map((area) => area.id));
                  const deletedIds = new Set(deletedAreaIds);
                  const refreshedAreas = remoteAreas.map((remoteArea) => {
                    const localArea = localById.get(remoteArea.id);
                    const localCards = new Map(localArea?.cards.map((card) => [card.id, card]));
                    return {
                      ...remoteArea,
                      ...(localArea?.sourceId ? { sourceId: localArea.sourceId } : {}),
                      cards: remoteArea.cards.map((remoteCard) => {
                        const localCard = localCards.get(remoteCard.id);
                        return localCard
                          ? {
                              ...remoteCard,
                              schedule: localCard.schedule,
                              sourceId: localCard.sourceId,
                            }
                          : remoteCard;
                      }),
                    };
                  });
                  return {
                    ...current,
                    areas: [
                      ...refreshedAreas,
                      ...current.areas.filter(
                        (area) => !remoteIds.has(area.id) && !deletedIds.has(area.id),
                      ),
                    ],
                    deletedAreas: (current.deletedAreas ?? [])
                      .filter((item) => !remoteIds.has(item.areaId))
                      .map((item) =>
                        deletedIds.has(item.areaId) ? { ...item, synced: true } : item,
                      ),
                    syncContentHashes: {
                      ...(current.syncContentHashes ?? {}),
                      ...contentHashes,
                    },
                  };
                });
              }}
            />
            <label className="text-button import-control" htmlFor="knowledge-area-import">
              Import JSON
            </label>
            <input
              id="knowledge-area-import"
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={importArea}
            />
            <label className="text-button import-control" htmlFor="knowledge-area-package-import">
              Import ZIP
            </label>
            <input
              id="knowledge-area-package-import"
              className="visually-hidden"
              type="file"
              accept="application/zip,.zip"
              onChange={importAreaPackage}
            />
            <button className="text-button" onClick={exportArea} disabled={!area}>
              Export JSON
            </button>
            <button
              className="text-button"
              onClick={() => void exportAreaPackage()}
              disabled={!area}
            >
              Export ZIP
            </button>
            <span className="saved-state">
              <i /> Saved on this device
            </span>
            <button className="help-button" aria-label="Help">
              ?
            </button>
          </div>
        </header>
        {importNotice && (
          <div className="notice-bar" role="status">
            {importNotice}
            {cacheBlocked && (
              <button className="notice-action" onClick={() => void discardSavedWorkspace()}>
                Clear saved data
              </button>
            )}
            <button aria-label="Dismiss notice" onClick={() => setImportNotice(null)}>
              ×
            </button>
          </div>
        )}
        {activeView === "Today" ? (
          <>
            <div className="content-wrap">
              <div className="greeting-row">
                <div>
                  <p className="eyebrow">SATURDAY, OCTOBER 3</p>
                  <h1>
                    A good day to <em>remember.</em>
                  </h1>
                  <p className="subheading">Small steps today make a big difference tomorrow.</p>
                </div>
                <div className="daily-mark">✳</div>
              </div>
              <div className="summary-grid">
                <div className="summary-card focus-card">
                  <div className="summary-top">
                    <span className="summary-icon green-icon">↗</span>
                    <span className="summary-tag">YOUR FOCUS</span>
                  </div>
                  <strong>{dueCount}</strong>
                  <p>cards ready to review</p>
                  <div className="mini-bars">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-top">
                    <span className="summary-icon peach-icon">◷</span>
                    <span className="summary-tag">IN YOUR AREAS</span>
                  </div>
                  <strong>{workspace.areas.length}</strong>
                  <p>learning areas</p>
                  <span className="summary-foot">{allCards.length} cards in your library</span>
                </div>
                <div className="summary-card">
                  <div className="summary-top">
                    <span className="summary-icon lilac-icon">✧</span>
                    <span className="summary-tag">YOUR PRACTICE</span>
                  </div>
                  <strong>{studiedToday}</strong>
                  <p>reviews completed</p>
                  <span className="summary-foot">On this device</span>
                </div>
              </div>

              <div className="section-title-row">
                <div>
                  <p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p>
                  <h2>Your learning areas</h2>
                </div>
                <div className="section-actions">
                  {area && (
                    <>
                      <button className="text-button" onClick={() => editArea(area)}>
                        Edit selected area
                      </button>
                      <button
                        className="text-button danger-text-button"
                        onClick={() => deleteArea(area)}
                      >
                        Delete selected area
                      </button>
                    </>
                  )}
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditingAreaId(null);
                      setAreaTitle("");
                      setAreaColor(
                        colors[workspace.areas.length % colors.length] ?? colors[0] ?? "#c4ed68",
                      );
                      setAddingArea(true);
                    }}
                  >
                    ＋ New area
                  </button>
                </div>
              </div>
              <div className="area-cards">
                {workspace.areas.map((item) => {
                  const pending = item.cards.filter((entry) => dueNow(entry, now)).length;
                  return (
                    <button
                      className={`learning-card ${selectedId === item.id ? "learning-card-active" : ""}`}
                      key={item.id}
                      onClick={() => {
                        setSelectedId(item.id);
                        setShowAnswer(false);
                      }}
                    >
                      <div className="learning-card-top">
                        <span className="large-area-dot" style={{ backgroundColor: item.color }} />
                        <span className="more-dots">···</span>
                      </div>
                      <h3>{item.title}</h3>
                      <p>
                        {item.cards.length} cards <span>·</span>{" "}
                        {new Set(item.cards.map((entry) => entry.objective)).size} learning goals
                      </p>
                      <div className="learning-card-bottom">
                        <span className="progress-track">
                          <i
                            style={{
                              width: `${item.cards.length ? Math.max(10, ((item.cards.length - pending) / item.cards.length) * 100) : 0}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </span>
                        <span className="due-label">
                          {pending ? `${pending} due` : "All caught up"}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <button className="new-learning-card" onClick={() => setAddingArea(true)}>
                  <span>＋</span>
                  <strong>Create a learning area</strong>
                  <small>Start with a topic you care about</small>
                </button>
              </div>

              <div className="section-title-row study-title">
                <div>
                  <p className="eyebrow">A FEW MINUTES, WELL SPENT</p>
                  <h2>Today&apos;s study</h2>
                </div>
                <span className="due-pill">{areaDue} to review</span>
              </div>
              <div className="study-layout">
                <ReviewCard
                  area={area}
                  card={card}
                  mediaPreviews={mediaPreviews}
                  showAnswer={showAnswer}
                  onReveal={() => setShowAnswer(true)}
                  onRate={review}
                  onEdit={editCard}
                  onDelete={deleteCard}
                  onAddCard={() => setAddingCard(true)}
                />
                <div className="study-aside">
                  <div className="aside-note">
                    <span className="note-icon">✦</span>
                    <h3>Make it yours.</h3>
                    <p>Add your own questions to build a study set that fits the way you learn.</p>
                    <button onClick={() => setAddingCard(true)}>＋ Add a card</button>
                  </div>
                  <div className="progress-note">
                    <div className="progress-note-top">
                      <span>YOUR LIBRARY</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="progress-track">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <p>
                      {allCards.length - dueCount} of {allCards.length} cards are resting.
                    </p>
                  </div>
                  {!demo && area && tutorAreaDocument && Either.isRight(tutorAreaDocument) && (
                    <TutorPanel
                      knowledgeArea={tutorAreaDocument.right}
                      objectiveGaps={objectiveGaps}
                      onApprove={(proposal: CardProposal, cardId: string) => {
                        const objective = area.objectives?.find(
                          (item) => item.id === proposal.objectiveId,
                        );
                        const approved: StudyCard = {
                          id: cardId,
                          front: proposal.front,
                          back: proposal.back,
                          objective: objective?.title ?? "AI tutor proposal",
                          ...(proposal.objectiveId ? { objectiveIds: [proposal.objectiveId] } : {}),
                          origin: "ai-generated",
                          schedule: newSchedule(),
                        };
                        setWorkspace((current) => ({
                          ...current,
                          areas: current.areas.map((item) =>
                            item.id === area.id
                              ? { ...item, cards: [...item.cards, approved] }
                              : item,
                          ),
                        }));
                        setImportNotice("AI card approved and added to your study queue.");
                      }}
                    />
                  )}
                  {!demo && area && tutorAreaDocument && Either.isLeft(tutorAreaDocument) && (
                    <p className="tutor-error" role="status">
                      The AI tutor is unavailable because this learning area has invalid content.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="content-wrap alternate-view">
            <p className="eyebrow">
              {activeView === "Explore" ? "GROW YOUR LIBRARY" : "YOUR LEARNING, OVER TIME"}
            </p>
            <h1>
              {activeView === "Explore" ? (
                <>
                  Make room for <em>curiosity.</em>
                </>
              ) : (
                <>
                  Progress that <em>adds up.</em>
                </>
              )}
            </h1>
            <p className="subheading">
              {activeView === "Explore"
                ? "Create a learning area for anything you want to understand."
                : "Your practice history is stored privately on this device."}
            </p>
            {activeView === "Explore" ? (
              <>
                <Button size="small" className="primary-action" onClick={() => setAddingArea(true)}>
                  ＋ Create a learning area
                </Button>
                <div className="interchange-tools" aria-label="Import and export tools">
                  <label className="text-button import-control" htmlFor="delimited-import">
                    Import CSV/TSV
                  </label>
                  <input
                    id="delimited-import"
                    className="visually-hidden"
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values"
                    onChange={importDelimited}
                  />
                  <button
                    className="text-button"
                    onClick={() => exportDelimited(",")}
                    disabled={!area}
                  >
                    Export CSV
                  </button>
                  <button
                    className="text-button"
                    onClick={() => exportDelimited("\t")}
                    disabled={!area}
                  >
                    Export TSV
                  </button>
                  <button className="text-button" onClick={exportWorkspaceBackup}>
                    Backup workspace
                  </button>
                  <label className="text-button import-control" htmlFor="workspace-backup-import">
                    Restore backup
                  </label>
                  <input
                    id="workspace-backup-import"
                    className="visually-hidden"
                    type="file"
                    accept="application/zip,.zip,application/json,.json"
                    onChange={restoreWorkspaceBackup}
                  />
                </div>
                {area && tutorAreaDocument && Either.isRight(tutorAreaDocument) && (
                  <KnowledgeAreaPublishing
                    area={tutorAreaDocument.right}
                    onFork={(document, attribution, license, forkedFromVersionId) => {
                      const provenanceDocument = {
                        ...document,
                        licence: license,
                        attribution,
                        forkedFromVersionId,
                      };
                      const imported = Effect.runSync(
                        Effect.either(
                          fromKnowledgeArea(
                            provenanceDocument,
                            colors[workspace.areas.length % colors.length] ?? "#c4ed68",
                            false,
                            () => crypto.randomUUID(),
                          ),
                        ),
                      );
                      if (Either.isLeft(imported)) return false;
                      setWorkspace((current) => ({
                        ...current,
                        areas: [...current.areas, imported.right],
                      }));
                      setSelectedId(imported.right.id);
                      setActiveView("Today");
                      setImportNotice(
                        `${imported.right.title} added as your copy. Attribution and license are shown in the shared-area review.`,
                      );
                      return true;
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <div className="insight-panel">
                  <strong>{studiedToday}</strong>
                  <span>reviews completed</span>
                  <p>
                    {dueCount} cards are ready across {workspace.areas.length} learning areas.
                  </p>
                </div>
                <section className="review-history" aria-labelledby="review-history-title">
                  <div className="review-history-heading">
                    <div>
                      <p className="eyebrow">YOUR PRIVATE PRACTICE</p>
                      <h2 id="review-history-title">Recent reviews</h2>
                    </div>
                    <span>{workspace.reviewEvents?.length ?? 0} total</span>
                  </div>
                  {reviewHistory.length ? (
                    <ol>
                      {reviewHistory.map((event) => (
                        <li key={event.id}>
                          <span className={`history-rating rating-${event.rating}`}>
                            {event.rating}
                          </span>
                          <span className="history-question">{event.question}</span>
                          <span className="history-area">
                            {event.areaTitle}
                            {event.hasConcurrentBranch && (
                              <StatusBadge tone="warning">Offline branch</StatusBadge>
                            )}
                            {event.needsSyncRetry && (
                              <StatusBadge tone="warning">Rebased · sync again</StatusBadge>
                            )}
                          </span>
                          <time dateTime={event.ratedAt}>
                            {new Date(event.ratedAt).toLocaleString("en-AU", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "UTC",
                            })}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState
                      className="history-empty"
                      title="No reviews yet"
                      description="Your completed reviews will appear here."
                    />
                  )}
                </section>
              </>
            )}
            <div className="alternate-list">
              {workspace.areas.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setActiveView("Today");
                  }}
                >
                  <i style={{ backgroundColor: item.color }} />
                  <span>{item.title}</span>
                  <small>{item.cards.length} cards</small>
                  <b>→</b>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {addingArea && (
        <Dialog labelledBy="area-dialog-title" onClose={closeAreaEditor}>
          <form className="modal" onSubmit={createArea}>
            <button className="modal-close" type="button" onClick={closeAreaEditor}>
              ×
            </button>
            <p className="eyebrow">
              {editingAreaId ? "SHAPE YOUR LIBRARY" : "START SOMETHING NEW"}
            </p>
            <h2 id="area-dialog-title">
              {editingAreaId ? "Edit learning area" : "Create a learning area"}
            </h2>
            <p className="modal-copy">
              {editingAreaId
                ? "Update the name and color used for this topic."
                : "Give your topic a name. You can add cards whenever you&apos;re ready."}
            </p>
            <label htmlFor="area-title">Area name</label>
            <input
              id="area-title"
              autoFocus
              value={areaTitle}
              onChange={(event) => setAreaTitle(event.target.value)}
              placeholder="e.g. Organic chemistry"
              maxLength={80}
            />
            <p className="area-color-label">Area color</p>
            <div className="area-color-options" role="group" aria-label="Area color">
              {colors.map((color) => (
                <button
                  key={color}
                  className={`area-color-option ${areaColor === color ? "selected" : ""}`}
                  type="button"
                  aria-label={`Choose ${color} color`}
                  aria-pressed={areaColor === color}
                  style={{ backgroundColor: color }}
                  onClick={() => setAreaColor(color)}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => {
                  setAddingArea(false);
                  setEditingAreaId(null);
                }}
              >
                Cancel
              </button>
              <Button
                size="small"
                className="primary-action"
                type="submit"
                disabled={!areaTitle.trim()}
              >
                {editingAreaId ? "Save changes" : "Create area"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {addingCard && (
        <Dialog
          labelledBy="card-dialog-title"
          onClose={() => {
            setAddingCard(false);
            setEditingCardId(null);
            setFront("");
            setBack("");
            setMediaFile(null);
          }}
        >
          <form className="modal" onSubmit={createCard}>
            <button
              className="modal-close"
              type="button"
              onClick={() => {
                setAddingCard(false);
                setEditingCardId(null);
                setFront("");
                setBack("");
                setMediaFile(null);
              }}
            >
              ×
            </button>
            <p className="eyebrow">{area?.title ?? "YOUR LIBRARY"}</p>
            <h2 id="card-dialog-title">{editingCardId ? "Edit study card" : "Add a study card"}</h2>
            <p className="modal-copy">
              {editingCardId
                ? "Update the question or answer. Your review schedule stays intact."
                : "Keep it focused: one useful question, one clear answer."}
            </p>
            <label htmlFor="card-front">Question</label>
            <textarea
              id="card-front"
              autoFocus
              value={front}
              onChange={(event) => setFront(event.target.value)}
              placeholder="What do you want to remember?"
              maxLength={500}
              rows={3}
            />
            <label htmlFor="card-back">Answer</label>
            <textarea
              id="card-back"
              value={back}
              onChange={(event) => setBack(event.target.value)}
              placeholder="Write the answer in your own words…"
              maxLength={1500}
              rows={4}
            />
            <label htmlFor="card-media">Attach image or audio (20 MB max)</label>
            <input
              id="card-media"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav"
              onChange={(event) => setMediaFile(event.currentTarget.files?.[0] ?? null)}
            />
            {mediaFile && <MediaFilePreview file={mediaFile} />}
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => {
                  setAddingCard(false);
                  setEditingCardId(null);
                  setFront("");
                  setBack("");
                  setMediaFile(null);
                }}
              >
                Cancel
              </button>
              <Button
                size="small"
                className="primary-action"
                type="submit"
                disabled={!front.trim() || !back.trim()}
              >
                {editingCardId ? "Save changes" : "Add card"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      <footer className="mobile-footer">
        <span className="brand-mark">r</span>
        <span>Recall, one card at a time.</span>
        <span>Saved on this device</span>
      </footer>
    </main>
  );
}
