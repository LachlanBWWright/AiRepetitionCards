"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import Image from "next/image";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  MediaReferenceSchema,
  WorkspaceSchema,
  createAreaId,
  type AreaId,
  parseKnowledgeAreaJson,
  parseWorkspaceJson,
  type MediaReference,
  type ReviewEvent,
  type CardSchedule,
} from "@recall/domain";
import { rebuildScheduleEffect, type ReviewRating } from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import {
  applyWorkspaceAuthoringCommand,
  type WorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
  formatTagInput,
  parseTagInput,
  persistTutorCardApproval,
  exportDelimitedCards,
  exportKnowledgeAreaPackage,
  importDelimitedCards,
  importKnowledgeAreaPackage,
  isSupportedMediaContent,
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
  saveWorkspaceWithMedia,
  loadWorkspace,
  recordReview,
  summarizeReviews,
  applyWorkspaceSyncChanges,
  bindWorkspaceOwner,
  workspaceHasRemoteSyncMetadata,
  type WorkspaceSyncCheckpointFailure,
  applyWorkspaceContentConflict,
  renderClozeCard,
  saveWorkspace,
  MAX_KNOWLEDGE_AREA_PACKAGE_BYTES,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
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
import { prepareWorkspaceForSync } from "@/features/workspace/sync-outbox";
import {
  browserWorkspaceStore,
  browserReviewWorkspaceStore,
} from "@/features/workspace/browser-workspace-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { eraseLocalData } from "@/features/workspace/erase-local-data";
import {
  localSnapshotStale,
  subscribeLocalSnapshot,
} from "@/features/workspace/local-snapshot-status";
import {
  localWritesBlocked,
  subscribeLocalWrites,
  setReviewWritePending,
} from "@/features/workspace/local-write-coordinator";
import { LocalChatGPTTutor as TutorPanel } from "@/components/tutor/LocalChatGPTTutor";
import { identifyObjectiveGaps, type CardProposal } from "@recall/ai-core";
import { KnowledgeAreaPublishing } from "@/components/publishing/KnowledgeAreaPublishing";
import { AnkiImportAction } from "@/features/interchange/AnkiImportAction";
import { KnowledgeAreaCardLibrary } from "@/components/knowledge/KnowledgeAreaCardLibrary";
import { KnowledgeAreaSettings } from "@/components/knowledge/KnowledgeAreaSettings";
import { SchedulerSettings } from "@/components/knowledge/SchedulerSettings";
import { isDesktopRuntime } from "@/lib/desktop-api";

const colors = ["#c4ed68", "#ffb29b", "#c4b5fd", "#f7cb70"];
const starter: Workspace = { schemaVersion: 1, reviews: 0, reviewEvents: [], areas: [] };

/** Demo identities stay in stories; every fresh device gets independent content identities. */
function createFreshStarterWorkspace() {
  return Effect.gen(function* () {
    const now = new Date();
    const areas = yield* Effect.forEach(mockWorkspace.areas, (area) =>
      Effect.gen(function* () {
        const document = yield* toKnowledgeArea(area);
        const ids = yield* Effect.try({
          try: () =>
            Array.from({ length: document.objectives.length + document.cards.length + 1 }, () =>
              crypto.randomUUID(),
            ),
          catch: () => ({ _tag: "StarterIdentityUnavailable" }) as const,
        });
        let index = 0;
        return yield* fromKnowledgeArea(document, area.color, false, () => ids[index++] ?? "", now);
      }),
    );
    return { ...starter, areas };
  });
}

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
  areaDraft?: LearningArea;
  areaEditFailure?: "stale-content" | "storage";
  deletionFailure?: "area" | "card";
  editCardId?: string;
  cardDraft?: StudyCard;
  cardEditConflict?: boolean;
  areaSettings?: boolean;
  showAnswer?: boolean;
  addCard?: boolean;
  localErasureBlocked?: boolean;
  localSnapshotStale?: boolean;
  reviewSaveState?: "saving" | "failure";
  missingReviewContent?: boolean;
  syncAccountState?: "account-mismatch" | "owner-adoption-required" | "ownership-checkpoint";
  mockMediaPreviews?: readonly { readonly mimeType: string; readonly url: string }[];
};

const staleCardDraftMessage =
  "This card changed while you were editing. Your draft is preserved. Reopen the latest card before saving.";

function cardEditingBaseline(workspace: Workspace, area: LearningArea, card: StudyCard) {
  return workspaceAuthoringBaseline(
    {
      ...workspace,
      areas: workspace.areas.map((item) =>
        item.id === area.id
          ? {
              ...item,
              cards: item.cards.map((existing) => (existing.id === card.id ? card : existing)),
            }
          : item,
      ),
    },
    {
      kind: "update-card",
      areaId: area.id,
      cardId: card.id,
      content: {
        kind: card.cloze ? "cloze" : "basic",
        front: card.front,
        back: card.back,
        cloze: card.cloze,
        objectiveIds: card.objectiveIds ?? [],
        tags: card.tags ?? [],
        media: card.media ?? [],
      },
    },
  );
}

type DeletionCommand = Extract<
  WorkspaceAuthoringCommand,
  { readonly kind: "delete-area" | "delete-card" }
>;
type DeletionRequest = {
  readonly command: DeletionCommand;
  readonly baseline: string;
  readonly label: string;
  readonly error: string;
  readonly stale: boolean;
};
const staleAreaDraftMessage =
  "This area changed while you were editing. Your draft is preserved. Reopen the latest area before saving.";
const areaSaveFailureMessage =
  "This area could not be saved on this device. Your draft is preserved; restore local storage before retrying.";
function areaEditingBaseline(workspace: Workspace, area: LearningArea): string {
  return (
    workspaceAuthoringBaseline(
      { ...workspace, areas: workspace.areas.map((item) => (item.id === area.id ? area : item)) },
      { kind: "save-area", mode: "edit", id: area.id, title: area.title, color: area.color },
    ) ?? ""
  );
}

type PendingReview = {
  readonly areaId: string;
  readonly cardId: string;
  readonly rating: ReviewRating;
  readonly eventId: string;
  readonly ratedAt: string;
  readonly event?: ReviewEvent;
  readonly schedule?: CardSchedule;
  readonly baseSchedule?: string;
  readonly baseEvents?: string;
};

type PendingContentImport = {
  readonly area?: LearningArea;
  readonly media?: readonly StoredMediaAsset[];
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly replacement?: Workspace;
  readonly expectedWorkspace?: Workspace;
  readonly message: string;
};

export default function Home({
  demo,
  sharedRequest,
}: {
  readonly demo?: StoryDemo;
  readonly sharedRequest?: { readonly versionId: string; readonly token?: string };
}) {
  const demoArea =
    demo?.areaDraft ?? demo?.workspace.areas.find((item) => item.id === demo.editAreaId);
  const demoCard =
    demo?.cardDraft ??
    demo?.workspace.areas.flatMap((item) => item.cards).find((item) => item.id === demo.editCardId);
  const [workspace, setWorkspaceState] = useState<Workspace>(
    demo?.workspace ?? { ...starter, reviewEvents: [] },
  );
  const workspaceRef = useRef(workspace);
  const workspaceSaveLane = useRef<Promise<void>>(Promise.resolve());
  const reviewingRef = useRef(demo?.reviewSaveState === "saving");
  const pendingReviewRef = useRef<PendingReview | null>(null);
  const [reviewSaving, setReviewSaving] = useState(demo?.reviewSaveState === "saving");
  const [reviewSaveFailed, setReviewSaveFailed] = useState(demo?.reviewSaveState === "failure");
  const [missingDeletedReviewContent, setMissingDeletedReviewContent] = useState(
    demo?.missingReviewContent ?? false,
  );
  const [deletedReviewProvisionCapacity, setDeletedReviewProvisionCapacity] = useState(false);
  const setWorkspace = useCallback(
    (update: SetStateAction<Workspace>) => {
      if (
        localWritesBlocked() ||
        localSnapshotStale() ||
        demo?.localErasureBlocked ||
        demo?.localSnapshotStale
      )
        return;
      if (pendingReviewRef.current) {
        setImportNotice(
          "Workspace changes are paused until the pending review is saved. Retry saving the review before editing or importing content.",
        );
        return;
      }
      const next = typeof update === "function" ? update(workspaceRef.current) : update;
      workspaceRef.current = next;
      setWorkspaceState(next);
    },
    [demo?.localErasureBlocked, demo?.localSnapshotStale],
  );
  const enqueueWorkspaceSave = useCallback(<A,>(operation: () => Promise<A>): Promise<A> => {
    const pending = workspaceSaveLane.current.then(operation);
    workspaceSaveLane.current = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }, []);
  const enqueueWorkspaceCommit = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.tryPromise({
      try: () =>
        enqueueWorkspaceSave(() =>
          Effect.runPromise(
            Effect.either(
              Effect.suspend<A, E | { readonly _tag: "WorkspaceCommitPaused" }, never>(() =>
                pendingReviewRef.current
                  ? Effect.fail({ _tag: "WorkspaceCommitPaused" } as const)
                  : operation,
              ),
            ),
          ),
        ),
      catch: () => ({ _tag: "WorkspaceCommitQueueFailure" }) as const,
    }).pipe(Effect.flatMap((result) => result));
  const [ready, setReady] = useState(false);
  const [cacheMayWrite, setCacheWritable] = useState(false);
  const [cacheHasProblem, setCacheBlocked] = useState(false);
  const localErased = useSyncExternalStore(subscribeLocalWrites, localWritesBlocked, () => false);
  const erased = demo?.localErasureBlocked ?? localErased;
  const localStale = useSyncExternalStore(subscribeLocalSnapshot, localSnapshotStale, () => false);
  const stale = demo?.localSnapshotStale ?? localStale;
  const cacheWritable = cacheMayWrite && !erased && !stale && !reviewSaveFailed && !reviewSaving;
  const cacheBlocked = cacheHasProblem || erased;
  const [selectedId, setSelectedId] = useState(
    demo?.selectedAreaId ?? demo?.editAreaId ?? "area-biology",
  );
  const [showAnswer, setShowAnswer] = useState(demo?.showAnswer ?? false);
  const [addingArea, setAddingArea] = useState(Boolean(demo?.editAreaId));
  const [editingAreaId, setEditingAreaId] = useState<string | null>(demo?.editAreaId ?? null);
  const [areaColor, setAreaColor] = useState(demoArea?.color ?? colors[0] ?? "#c4ed68");
  const areaEditor = useRef<{
    generation: number;
    id: AreaId | null;
    baseline: string | undefined;
  }>({
    generation: 0,
    id: demoArea?.id ?? null,
    baseline: demoArea ? areaEditingBaseline(workspace, demoArea) : undefined,
  });
  const libraryMutationPending = useRef(false);
  const [libraryMutation, setLibraryMutation] = useState<
    "area-save" | "area-delete" | "card-delete" | null
  >(null);
  const [areaEditorError, setAreaEditorError] = useState<string | null>(
    demo?.areaEditFailure === "stale-content"
      ? staleAreaDraftMessage
      : demo?.areaEditFailure === "storage"
        ? areaSaveFailureMessage
        : null,
  );
  const [areaDraftStale, setAreaDraftStale] = useState(demo?.areaEditFailure === "stale-content");
  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(() => {
    const targetArea = workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0];
    const card = targetArea?.cards[0];
    if (!demo?.deletionFailure || !targetArea || (demo.deletionFailure === "card" && !card))
      return null;
    const command: DeletionCommand =
      demo.deletionFailure === "card" && card
        ? { kind: "delete-card", areaId: targetArea.id, cardId: card.id }
        : { kind: "delete-area", areaId: targetArea.id };
    return {
      command,
      baseline: workspaceAuthoringBaseline(workspace, command) ?? "",
      label: demo.deletionFailure === "card" ? (card?.front ?? "card") : targetArea.title,
      error:
        "Deletion could not be saved on this device. The content and review history remain available. Restore local storage before retrying.",
      stale: false,
    };
  });
  const [addingCard, setAddingCard] = useState(Boolean(demo?.addCard || demoCard));
  const [editingCardId, setEditingCardId] = useState<string | null>(demoCard?.id ?? null);
  const initialEditorArea = demoCard
    ? workspace.areas.find((item) => item.cards.some((card) => card.id === demoCard.id))
    : undefined;
  const cardEditor = useRef({
    generation: 0,
    baseline:
      demoCard && initialEditorArea
        ? cardEditingBaseline(workspace, initialEditorArea, demoCard)
        : undefined,
    sourceCard: demoCard ?? null,
  });
  const cardEditorMounted = useRef(true);
  const cardSavePending = useRef(false);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardEditorError, setCardEditorError] = useState<string | null>(
    demo?.cardEditConflict ? staleCardDraftMessage : null,
  );
  const [cardDraftStale, setCardDraftStale] = useState(demo?.cardEditConflict ?? false);
  useEffect(() => {
    cardEditorMounted.current = true;
    return () => {
      cardEditorMounted.current = false;
      cardEditor.current.generation += 1;
      areaEditor.current.generation += 1;
    };
  }, []);
  const [areaTitle, setAreaTitle] = useState(demoArea?.title ?? "");
  const [front, setFront] = useState(demoCard?.front ?? "");
  const [back, setBack] = useState(demoCard?.back ?? "");
  const [cardKind, setCardKind] = useState<"basic" | "cloze">(demoCard?.cloze ? "cloze" : "basic");
  const [clozeText, setClozeText] = useState(demoCard?.cloze?.text ?? "");
  const [clozeIndex, setClozeIndex] = useState(String(demoCard?.cloze?.deletionIndex ?? 1));
  const [cardObjectiveIds, setCardObjectiveIds] = useState<readonly string[]>(
    demoCard?.objectiveIds ?? [],
  );
  const [cardTags, setCardTags] = useState(formatTagInput(demoCard?.tags ?? []));
  const [removedMediaIds, setRemovedMediaIds] = useState<readonly string[]>([]);
  const [showAreaSettings, setShowAreaSettings] = useState(demo?.areaSettings ?? false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviews, setMediaPreviews] = useState<
    readonly { readonly mimeType: string; readonly url: string }[]
  >(() => demo?.mockMediaPreviews ?? []);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [pendingContentImport, setPendingContentImport] = useState<PendingContentImport | null>(
    null,
  );
  const [contentImportBusy, setContentImportBusy] = useState(false);
  const contentImportPending = useRef(false);

  function beginContentImport() {
    if (contentImportPending.current || pendingContentImport) {
      setImportNotice("Finish or cancel the current import before selecting another file.");
      return false;
    }
    contentImportPending.current = true;
    setContentImportBusy(true);
    return true;
  }

  function failContentImport(message: string) {
    contentImportPending.current = false;
    if (!cardEditorMounted.current) return;
    setContentImportBusy(false);
    setImportNotice(message);
  }

  async function commitContentImport(request: PendingContentImport) {
    if (!cardEditorMounted.current) return false;
    contentImportPending.current = true;
    setContentImportBusy(true);
    setPendingContentImport(request);
    const saved = await Effect.runPromise(
      Effect.either(
        enqueueWorkspaceCommit(
          Effect.gen(function* () {
            for (;;) {
              if (
                !cardEditorMounted.current ||
                localWritesBlocked() ||
                localSnapshotStale() ||
                pendingReviewRef.current
              )
                return yield* Effect.fail({
                  message:
                    "Local changes are paused. The import is retained; recover storage or save the pending review before retrying.",
                });
              if (!demo && (!ready || !cacheWritable))
                return yield* Effect.fail({
                  message:
                    "The import has not been saved. Recover local storage, then retry the same import.",
                });
              const current = workspaceRef.current;
              if (request.replacement && current !== request.expectedWorkspace)
                return yield* Effect.fail({
                  message:
                    "Your workspace changed before the backup could be restored. Confirm replacement again to retry; the current workspace is unchanged.",
                });
              const existing =
                request.area && current.areas.find((item) => item.id === request.area?.id);
              if (existing && JSON.stringify(existing) !== JSON.stringify(request.area))
                return yield* Effect.fail({
                  message:
                    "The imported area already exists with newer changes. Cancel this import to keep those changes; no content was overwritten.",
                });
              const incomingEvents = request.reviewEvents ?? [];
              const currentEvents = new Map(
                (current.reviewEvents ?? []).map((event) => [event.id, event]),
              );
              if (
                incomingEvents.some(
                  (event) =>
                    currentEvents.has(event.id) &&
                    JSON.stringify(currentEvents.get(event.id)) !== JSON.stringify(event),
                )
              )
                return yield* Effect.fail({
                  message:
                    "An imported review identity conflicts with existing history. No reviews were overwritten.",
                });
              const newEvents = incomingEvents.filter((event) => !currentEvents.has(event.id));
              const candidate = yield* Schema.decodeUnknown(WorkspaceSchema)(
                request.replacement ?? {
                  ...current,
                  areas:
                    existing || !request.area ? current.areas : [...current.areas, request.area],
                  ...(incomingEvents.length > 0
                    ? {
                        reviews: current.reviews + newEvents.length,
                        reviewEvents: [...(current.reviewEvents ?? []), ...newEvents],
                      }
                    : {}),
                },
              ).pipe(
                Effect.mapError(() => ({
                  message:
                    "The imported content exceeds workspace limits or has conflicting identities. No content was imported.",
                })),
              );
              if (!demo) {
                const storageMessage = {
                  message:
                    "The import could not be confirmed saved. Its content is retained; retry before leaving this page.",
                };
                if (request.media)
                  yield* saveWorkspaceWithMedia(
                    browserWorkspaceStore,
                    browserMediaStore,
                    candidate,
                    request.media,
                  ).pipe(Effect.mapError(() => storageMessage));
                else
                  yield* saveWorkspace(browserWorkspaceStore, candidate).pipe(
                    Effect.mapError(() => storageMessage),
                  );
              }
              if (
                !cardEditorMounted.current ||
                localWritesBlocked() ||
                localSnapshotStale() ||
                pendingReviewRef.current
              )
                return yield* Effect.fail({
                  message:
                    "The import could not be confirmed because local writes were paused. Its content is retained for retry.",
                });
              if (workspaceRef.current !== current) continue;
              setWorkspace(candidate);
              return candidate;
            }
          }),
        ).pipe(
          Effect.mapError((error) =>
            "message" in error
              ? error.message
              : "The import is paused. Save the pending review, then retry.",
          ),
        ),
      ),
    );
    contentImportPending.current = false;
    if (!cardEditorMounted.current) return false;
    setContentImportBusy(false);
    if (Either.isLeft(saved)) {
      setImportNotice(saved.left);
      return false;
    }
    setPendingContentImport(null);
    setSelectedId(request.area?.id ?? saved.right.areas[0]?.id ?? "");
    setShowAnswer(false);
    setActiveView("Today");
    setImportNotice(request.message);
    return true;
  }
  const [activeView, setActiveView] = useState(demo?.view ?? (sharedRequest ? "Explore" : "Today"));
  const [now, setNow] = useState(() => new Date(demo ? "2026-10-03T09:00:00.000Z" : Date.now()));

  useEffect(() => {
    if (demo) {
      const hydration = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(hydration);
    }
    let active = true;
    void Effect.runPromise(Effect.either(loadWorkspace(browserWorkspaceStore))).then(
      async (loadResult) => {
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
        } else {
          const fresh = await Effect.runPromise(Effect.either(createFreshStarterWorkspace()));
          if (!active) return;
          if (Either.isRight(fresh)) loaded = fresh.right;
          else {
            canWriteCache = false;
            cacheProblem = "A fresh workspace could not be created. Reload before saving changes.";
          }
        }
        setWorkspace(prepareWorkspaceForSync(loaded, () => crypto.randomUUID()));
        setSelectedId(loaded.areas[0]?.id ?? "");
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
  }, [demo, setWorkspace]);

  useEffect(() => {
    if (ready && !demo && cacheWritable) {
      void enqueueWorkspaceSave(() =>
        workspaceRef.current === workspace && !pendingReviewRef.current && !reviewingRef.current
          ? Effect.runPromise(Effect.either(saveWorkspace(browserWorkspaceStore, workspace)))
          : Promise.resolve(Either.right(undefined)),
      ).then((result) => {
        if (Either.isLeft(result)) {
          if (pendingReviewRef.current || reviewingRef.current) return;
          setCacheWritable(false);
          setCacheBlocked(true);
          setImportNotice(
            "Workspace storage could not save changes. They will stay in this session.",
          );
        }
      });
    }
  }, [cacheWritable, demo, ready, workspace, enqueueWorkspaceSave]);

  async function discardSavedWorkspace() {
    if (demo) {
      setImportNotice("Mock local cleanup is ready to retry.");
      return;
    }
    setCacheWritable(false);
    setCacheBlocked(true);
    const cleared = await Effect.runPromise(eraseLocalData());
    if (!cleared) {
      setImportNotice(
        "This device is read-only because some local data could not be cleared. Retry clearing saved data before continuing.",
      );
      return;
    }
    window.location.reload();
  }

  const area = workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0];
  const publishingAreaDocument = useMemo(
    () => (area ? Effect.runSync(Effect.either(toKnowledgeArea(area, true, true))) : null),
    [area],
  );
  const tutorAreaDocument = publishingAreaDocument;
  const clozePreview = useMemo(
    () =>
      cardKind === "cloze"
        ? Effect.runSync(Effect.either(renderClozeCard(clozeText, Number(clozeIndex))))
        : null,
    [cardKind, clozeText, clozeIndex],
  );
  const lineageAreaDocument = useMemo(
    () => (area ? Effect.runSync(Effect.either(toKnowledgeArea(area, false, true))) : null),
    [area],
  );
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
  const practice = useMemo(() => {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const events = workspace.reviewEvents ?? [];
    return {
      today: summarizeReviews(events, dayStart, now),
      week: summarizeReviews(events, weekStart, now),
    };
  }, [workspace.reviewEvents, now]);
  const studiedToday = practice.today.inWindow;
  const totalReviews = Math.max(workspace.reviews, practice.today.total);
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
          workspace.areas.find((item) => item.id === event.areaId)?.title ??
          workspace.retainedReviewAreas?.find((item) => item.id === event.areaId)?.title ??
          "Removed area",
        question:
          workspace.areas
            .find((item) => item.id === event.areaId)
            ?.cards.find((item) => item.id === event.cardId)?.front ??
          workspace.retainedReviewAreas
            ?.find((item) => item.id === event.areaId)
            ?.cards.find((item) => item.id === event.cardId)?.front ??
          "Removed card",
        retainedForSync:
          workspace.retainedReviewAreas?.some(
            (item) =>
              item.id === event.areaId && item.cards.some((entry) => entry.id === event.cardId),
          ) ?? false,
      }));
  }, [
    workspace.areas,
    workspace.reviewEvents,
    workspace.reviewConflictIds,
    workspace.retainedReviewAreas,
  ]);
  const retainedCards = (workspace.retainedReviewAreas ?? []).flatMap((item) => item.cards).length;
  const deletedRetainedAreas = (workspace.retainedReviewAreas ?? []).filter(
    (item) => !workspace.areas.some((active) => active.id === item.id),
  ).length;
  const pendingIds = new Set(workspace.pendingReviewEventIds ?? []);
  const retainedPendingReviews = (workspace.reviewEvents ?? []).filter(
    (event) =>
      pendingIds.has(event.id) &&
      workspace.retainedReviewAreas?.some(
        (item) => item.id === event.areaId && item.cards.some((entry) => entry.id === event.cardId),
      ),
  ).length;

  async function review(rating: ReviewRating) {
    if (reviewingRef.current || (!pendingReviewRef.current && (!area || !card || !showAnswer)))
      return;
    if (
      erased ||
      stale ||
      localWritesBlocked() ||
      localSnapshotStale() ||
      (!demo && (!ready || !cacheMayWrite))
    ) {
      setImportNotice(
        "Local storage must be writable before a review can be saved. Export this tab before reloading if it has unsaved changes.",
      );
      return;
    }
    if (!pendingReviewRef.current && area && card) {
      const latest = workspaceRef.current.areas
        .find((item) => item.id === area.id)
        ?.cards.find((item) => item.id === card.id);
      if (!latest || JSON.stringify(latest.schedule) !== JSON.stringify(card.schedule)) return;
    }
    reviewingRef.current = true;
    setReviewSaving(true);
    setReviewSaveFailed(false);
    const outcome = await enqueueWorkspaceSave(async () => {
      if (!pendingReviewRef.current) {
        if (!area || !card) return false;
        const identity = Effect.runSync(
          Effect.either(
            Effect.try({
              try: () => crypto.randomUUID(),
              catch: () => ({ _tag: "ReviewIdentityUnavailable" }) as const,
            }),
          ),
        );
        if (Either.isLeft(identity)) return false;
        pendingReviewRef.current = {
          areaId: area.id,
          cardId: card.id,
          rating,
          eventId: identity.right,
          ratedAt: new Date().toISOString(),
          baseSchedule: JSON.stringify(card.schedule),
        };
      }
      if (!demo) setReviewWritePending(true);
      for (;;) {
        if (localWritesBlocked() || localSnapshotStale()) return false;
        const current = workspaceRef.current;
        const attempt: PendingReview = pendingReviewRef.current;
        const currentCard = current.areas
          .find((item) => item.id === attempt.areaId)
          ?.cards.find((item) => item.id === attempt.cardId);
        if (
          !currentCard ||
          (!attempt.event && JSON.stringify(currentCard.schedule) !== attempt.baseSchedule)
        ) {
          if (!attempt.event) {
            pendingReviewRef.current = null;
            if (!demo) setReviewWritePending(false);
            return "superseded" as const;
          }
          return false;
        }
        const targetEvents = (current.reviewEvents ?? []).filter(
          (event) => event.areaId === attempt.areaId && event.cardId === attempt.cardId,
        );
        let candidate: Workspace;
        if (!attempt.event || !attempt.schedule) {
          const transition = Effect.runSync(
            Effect.either(recordReview({ workspace: current, ...attempt })),
          );
          if (Either.isLeft(transition)) return false;
          const schedule = transition.right.workspace.areas
            .find((item) => item.id === attempt.areaId)
            ?.cards.find((item) => item.id === attempt.cardId)?.schedule;
          if (!schedule) return false;
          pendingReviewRef.current = {
            ...attempt,
            event: transition.right.event,
            schedule,
            baseSchedule: JSON.stringify(currentCard.schedule),
            baseEvents: JSON.stringify(targetEvents),
          };
          candidate = transition.right.workspace;
        } else if ((current.reviewEvents ?? []).some((event) => event.id === attempt.event?.id)) {
          candidate = current;
        } else {
          const schedule =
            JSON.stringify(currentCard.schedule) === attempt.baseSchedule &&
            JSON.stringify(targetEvents) === attempt.baseEvents
              ? Either.right(attempt.schedule)
              : await Effect.runPromise(
                  Effect.either(rebuildScheduleEffect([...targetEvents, attempt.event])),
                );
          if (Either.isLeft(schedule)) return false;
          candidate = {
            ...current,
            reviewEvents: [...(current.reviewEvents ?? []), attempt.event],
            pendingReviewEventIds: [
              ...new Set([...(current.pendingReviewEventIds ?? []), attempt.event.id]),
            ],
            reviews: Math.max(current.reviews, (current.reviewEvents ?? []).length) + 1,
            areas: current.areas.map((item) =>
              item.id === attempt.areaId
                ? {
                    ...item,
                    cards: item.cards.map((entry) =>
                      entry.id === attempt.cardId ? { ...entry, schedule: schedule.right } : entry,
                    ),
                  }
                : item,
            ),
          };
        }
        if (demo?.reviewSaveState === "failure") return false;
        const saved = demo
          ? Either.right(undefined)
          : await Effect.runPromise(
              Effect.either(saveWorkspace(browserReviewWorkspaceStore, candidate)),
            );
        if (Either.isLeft(saved) || localWritesBlocked() || localSnapshotStale()) return false;
        if (workspaceRef.current !== current) continue;
        workspaceRef.current = candidate;
        setWorkspaceState(candidate);
        pendingReviewRef.current = null;
        if (!demo) setReviewWritePending(false);
        setShowAnswer(false);
        setNow(new Date());
        return true;
      }
    });
    reviewingRef.current = false;
    setReviewSaving(false);
    if (outcome === "superseded") {
      setShowAnswer(false);
      setImportNotice(
        "The study queue changed before this review started saving. Reveal the current question's answer before rating it.",
      );
      return;
    }
    if (!outcome) setReviewSaveFailed(true);
  }

  async function createArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (libraryMutationPending.current || cardSavePending.current) return;
    const title = areaTitle.trim();
    if (!title) return;
    const id = areaEditor.current.id ?? createAreaId(crypto.randomUUID());
    areaEditor.current.id = id;
    const generation = areaEditor.current.generation;
    const command: WorkspaceAuthoringCommand = {
      kind: "save-area",
      mode: editingAreaId ? "edit" : "create",
      id,
      title,
      color: areaColor,
    };
    libraryMutationPending.current = true;
    setLibraryMutation("area-save");
    setAreaEditorError(null);
    const result = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(command, areaEditor.current.baseline)),
    );
    libraryMutationPending.current = false;
    if (!cardEditorMounted.current || areaEditor.current.generation !== generation) return;
    setLibraryMutation(null);
    if (Either.isLeft(result)) {
      setAreaDraftStale(result.left.reason === "stale-content");
      setAreaEditorError(
        result.left.reason === "stale-content" ? staleAreaDraftMessage : result.left.message,
      );
      return;
    }
    setSelectedId(id);
    setImportNotice(
      editingAreaId
        ? `${title} updated and saved on this device.`
        : `${title} created and saved on this device.`,
    );
    closeAreaEditor();
  }

  function editArea(target: LearningArea) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    const current = workspaceRef.current;
    const latest = current.areas.find((item) => item.id === target.id);
    if (!latest) return;
    areaEditor.current = {
      generation: areaEditor.current.generation + 1,
      id: latest.id,
      baseline: areaEditingBaseline(current, latest),
    };
    setEditingAreaId(latest.id);
    setAreaTitle(latest.title);
    setAreaColor(latest.color);
    setAreaEditorError(null);
    setAreaDraftStale(false);
    setAddingArea(true);
  }

  function closeAreaEditor() {
    if (libraryMutationPending.current) return;
    areaEditor.current = {
      generation: areaEditor.current.generation + 1,
      id: null,
      baseline: undefined,
    };
    setAddingArea(false);
    setEditingAreaId(null);
    setAreaTitle("");
    setAreaColor(
      colors[workspaceRef.current.areas.length % colors.length] ?? colors[0] ?? "#c4ed68",
    );
    setAreaEditorError(null);
    setAreaDraftStale(false);
  }

  function addArea() {
    if (libraryMutationPending.current || cardSavePending.current) return;
    closeAreaEditor();
    setAddingArea(true);
  }

  async function commitDeletion(request: DeletionRequest) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    libraryMutationPending.current = true;
    setLibraryMutation(request.command.kind === "delete-area" ? "area-delete" : "card-delete");
    setDeletionRequest(request);
    const result = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(request.command, request.baseline)),
    );
    libraryMutationPending.current = false;
    if (!cardEditorMounted.current) return;
    setLibraryMutation(null);
    if (Either.isLeft(result)) {
      setDeletionRequest({
        ...request,
        error: result.left.message,
        stale: result.left.reason === "stale-content",
      });
      return;
    }
    setDeletionRequest(null);
    if (request.command.kind === "delete-area")
      setSelectedId((currentSelected) =>
        currentSelected === request.command.areaId
          ? (result.right.areas[0]?.id ?? "")
          : currentSelected,
      );
    setShowAnswer(false);
    setImportNotice(
      `${request.label} was removed and saved on this device. Review history remains saved; sync to remove the content from your other devices.`,
    );
  }

  async function deleteArea(target: LearningArea) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    const current = workspaceRef.current;
    const latest = current.areas.find((item) => item.id === target.id);
    if (!latest) {
      setImportNotice("This learning area is no longer available. Your workspace was preserved.");
      return;
    }
    const command: DeletionCommand = { kind: "delete-area", areaId: latest.id };
    const baseline = workspaceAuthoringBaseline(current, command) ?? "";
    if (
      !window.confirm(
        `Delete “${latest.title}” and its ${latest.cards.length} cards? Its review history will remain on this device.`,
      )
    )
      return;
    await commitDeletion({ command, baseline, label: latest.title, error: "", stale: false });
  }

  async function retryDeletion() {
    if (!deletionRequest || libraryMutationPending.current) return;
    if (!deletionRequest.stale) {
      await commitDeletion(deletionRequest);
      return;
    }
    const current = workspaceRef.current;
    const latestArea = current.areas.find((item) => item.id === deletionRequest.command.areaId);
    if (!latestArea) {
      setDeletionRequest({
        ...deletionRequest,
        error:
          "This content is no longer available. Cancel this deletion request and inspect your current library.",
      });
      return;
    }
    if (deletionRequest.command.kind === "delete-area") {
      await deleteArea(latestArea);
      return;
    }
    const requestedCardId = deletionRequest.command.cardId;
    const latestCard = latestArea.cards.find((item) => item.id === requestedCardId);
    if (!latestCard) {
      setDeletionRequest({
        ...deletionRequest,
        error:
          "This card is no longer available. Cancel this deletion request and inspect your current library.",
      });
      return;
    }
    await deleteCard(latestCard);
  }

  const saveAuthoringCommand = (command: WorkspaceAuthoringCommand, expectedBaseline?: string) =>
    enqueueWorkspaceCommit(
      Effect.gen(function* () {
        for (;;) {
          if (
            !cardEditorMounted.current ||
            localWritesBlocked() ||
            localSnapshotStale() ||
            pendingReviewRef.current
          )
            return yield* Effect.fail({ _tag: "SettingsCommitPaused" } as const);
          if (!demo && (!ready || !cacheWritable))
            return yield* Effect.fail({ _tag: "SettingsStorageUnavailable" } as const);
          const current = workspaceRef.current;
          const prepared = yield* applyWorkspaceAuthoringCommand(
            current,
            command,
            new Date(),
            expectedBaseline,
          );
          if (!demo) yield* saveWorkspace(browserWorkspaceStore, prepared.workspace);
          if (localWritesBlocked() || localSnapshotStale() || pendingReviewRef.current)
            return yield* Effect.fail({ _tag: "SettingsCommitPaused" } as const);
          if (workspaceRef.current !== current) continue;
          setWorkspace(prepared.workspace);
          return prepared.workspace;
        }
      }),
    ).pipe(
      Effect.mapError((error) => {
        if (error._tag === "WorkspaceAuthoringFailure")
          return {
            reason:
              error.reason === "stale-content"
                ? ("stale-content" as const)
                : ("unavailable" as const),
            message:
              error.reason === "stale-content"
                ? "This content changed before your change could be saved. Your draft or deletion request is preserved. Review the latest content before retrying."
                : error.message,
          };
        if (error._tag === "SettingsCommitPaused" || error._tag === "WorkspaceCommitPaused")
          return {
            reason: "paused" as const,
            message:
              "Local changes are paused. Your draft is preserved; restore storage or save the pending review before retrying.",
          };
        return {
          reason: "storage" as const,
          message:
            "This change could not be saved on this device. Your draft or deletion request is preserved; restore local storage before retrying.",
        };
      }),
    );

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!area || cardSavePending.current) return;
    const parsedTags = parseTagInput(cardTags);
    if (Either.isLeft(parsedTags)) {
      setCardEditorError(parsedTags.left.message);
      return;
    }
    if (!demo && (!ready || !cacheWritable)) {
      setCardEditorError("Restore local storage before saving this card. Your draft is preserved.");
      return;
    }
    const editorGeneration = cardEditor.current.generation;
    const expectedBaseline = editingCardId ? cardEditor.current.baseline : undefined;
    const isCurrent = () =>
      cardEditorMounted.current && cardEditor.current.generation === editorGeneration;
    const media = (cardEditor.current.sourceCard?.media ?? []).filter(
      (reference) => !removedMediaIds.includes(reference.id),
    );
    const cardId = editingCardId ?? crypto.randomUUID();
    const createdAt = new Date();
    const command = (references: readonly MediaReference[]) => ({
      kind: editingCardId ? ("update-card" as const) : ("create-card" as const),
      areaId: area.id,
      cardId,
      content: {
        kind: cardKind,
        front,
        back,
        cloze:
          cardKind === "cloze" ? { text: clozeText, deletionIndex: Number(clozeIndex) } : undefined,
        objectiveIds: cardObjectiveIds,
        tags: parsedTags.right,
        media: references,
      },
    });
    const reject = (message: string, staleDraft = false) => {
      if (!isCurrent()) return;
      setCardEditorError(staleDraft ? staleCardDraftMessage : message);
      setCardDraftStale(staleDraft);
    };
    const preflight = Effect.runSync(
      Effect.either(
        applyWorkspaceAuthoringCommand(
          workspaceRef.current,
          command(media),
          createdAt,
          expectedBaseline,
        ),
      ),
    );
    if (Either.isLeft(preflight)) {
      reject(preflight.left.message, preflight.left.reason === "stale-content");
      return;
    }
    if (mediaFile && (media.length >= 20 || mediaFile.size < 1 || mediaFile.size > 20_000_000)) {
      reject(
        media.length >= 20
          ? "A card can have up to 20 attachments. Remove one before adding another."
          : "Media must be smaller than 20 MB.",
      );
      return;
    }
    cardSavePending.current = true;
    setCardSaving(true);
    setCardEditorError(null);
    const assets: StoredMediaAsset[] = [];
    if (mediaFile) {
      const mimeType = mediaFile.type;
      const read = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => mediaFile.arrayBuffer(),
            catch: () => ({ _tag: "MediaAttachmentFailure" }) as const,
          }).pipe(
            Effect.flatMap((buffer) => {
              const bytes = new Uint8Array(buffer);
              const id = Array.from(sha256(bytes), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join("");
              const decoded = Schema.decodeUnknownEither(MediaReferenceSchema)({
                id,
                mimeType,
                byteLength: bytes.byteLength,
              });
              return Either.isLeft(decoded) ||
                !isSupportedMediaContent(bytes, decoded.right.mimeType)
                ? Effect.fail({ _tag: "MediaAttachmentFailure" } as const)
                : Effect.succeed({ reference: decoded.right, bytes });
            }),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(read)) {
        reject("Choose a supported image or audio file. Your draft is preserved.");
        cardSavePending.current = false;
        setCardSaving(false);
        return;
      }
      if (!media.some((reference) => reference.id === read.right.reference.id)) {
        media.push(read.right.reference);
      }
      assets.push(read.right);
    }
    const accepted = await enqueueWorkspaceSave(async () => {
      for (;;) {
        if (!isCurrent()) return false;
        if (localWritesBlocked() || localSnapshotStale() || pendingReviewRef.current) {
          reject(
            "Local changes are paused. Your draft is preserved; restore storage or save the pending review before retrying.",
          );
          return false;
        }
        const current = workspaceRef.current;
        const prepared = Effect.runSync(
          Effect.either(
            applyWorkspaceAuthoringCommand(current, command(media), createdAt, expectedBaseline),
          ),
        );
        if (Either.isLeft(prepared)) {
          reject(prepared.left.message, prepared.left.reason === "stale-content");
          return false;
        }
        if (!demo) {
          const saved = await Effect.runPromise(
            Effect.either(
              saveWorkspaceWithMedia(
                browserWorkspaceStore,
                browserMediaStore,
                prepared.right.workspace,
                assets,
              ),
            ),
          );
          if (!isCurrent()) return false;
          if (Either.isLeft(saved)) {
            reject(
              saved.left.reason === "media-rollback"
                ? "This card could not be saved and attachment cleanup failed. Your draft is preserved; restore local storage before retrying."
                : "This card could not be saved on this device. Your draft is preserved; retry when local storage is available.",
            );
            return false;
          }
        }
        if (
          !isCurrent() ||
          localWritesBlocked() ||
          localSnapshotStale() ||
          pendingReviewRef.current
        ) {
          reject(
            "Local changes are paused. Your draft is preserved; restore storage before retrying.",
          );
          return false;
        }
        if (workspaceRef.current !== current) continue;
        setWorkspace(prepared.right.workspace);
        return true;
      }
    });
    if (!isCurrent()) return;
    cardSavePending.current = false;
    setCardSaving(false);
    if (!accepted) return;
    closeCardEditor();
    setShowAnswer(false);
  }

  function editCard(target: StudyCard) {
    if (cardSavePending.current) return;
    const latest = workspaceRef.current;
    const ownerArea = latest.areas.find((item) => item.cards.some((card) => card.id === target.id));
    if (!ownerArea) return;
    const latestCard = ownerArea.cards.find((card) => card.id === target.id);
    if (!latestCard) return;
    cardEditor.current = {
      generation: cardEditor.current.generation + 1,
      baseline: cardEditingBaseline(latest, ownerArea, latestCard),
      sourceCard: latestCard,
    };
    setCardEditorError(null);
    setCardDraftStale(false);
    setSelectedId(ownerArea.id);
    setEditingCardId(latestCard.id);
    setFront(latestCard.front);
    setBack(latestCard.back);
    setCardKind(latestCard.cloze ? "cloze" : "basic");
    setClozeText(latestCard.cloze?.text ?? "");
    setClozeIndex(String(latestCard.cloze?.deletionIndex ?? 1));
    setCardObjectiveIds(
      latestCard.objectiveIds ??
        (ownerArea.objectives ?? [])
          .filter((objective) => objective.title === latestCard.objective)
          .map((objective) => objective.id),
    );
    setCardTags(formatTagInput(latestCard.tags ?? []));
    setRemovedMediaIds([]);
    setMediaFile(null);
    setAddingCard(true);
  }

  function closeCardEditor() {
    if (cardSavePending.current) return;
    cardEditor.current = {
      generation: cardEditor.current.generation + 1,
      baseline: undefined,
      sourceCard: null,
    };
    setCardEditorError(null);
    setCardDraftStale(false);
    setAddingCard(false);
    setEditingCardId(null);
    setFront("");
    setBack("");
    setCardKind("basic");
    setClozeText("");
    setClozeIndex("1");
    setCardObjectiveIds([]);
    setCardTags(formatTagInput([]));
    setRemovedMediaIds([]);
    setMediaFile(null);
  }

  function addCard() {
    if (cardSavePending.current) return;
    closeCardEditor();
    setAddingCard(true);
  }

  async function deleteCard(target: StudyCard) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    const current = workspaceRef.current;
    const latestArea = current.areas.find((item) =>
      item.cards.some((card) => card.id === target.id),
    );
    const latestCard = latestArea?.cards.find((item) => item.id === target.id);
    if (!latestArea || !latestCard) {
      setImportNotice("This card is no longer available. Your workspace was preserved.");
      return;
    }
    const command: DeletionCommand = {
      kind: "delete-card",
      areaId: latestArea.id,
      cardId: latestCard.id,
    };
    const baseline = workspaceAuthoringBaseline(current, command) ?? "";
    if (
      !window.confirm(`Delete this study card from “${latestArea.title}”?

${latestCard.front}

Its review history will remain.`)
    )
      return;
    await commitDeletion({ command, baseline, label: latestCard.front, error: "", stale: false });
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

  function exportWorkspaceSnapshot() {
    const exported = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () =>
            downloadText(
              "recall-unsaved-workspace.json",
              JSON.stringify(
                {
                  backupVersion: 1,
                  exportedAt: new Date().toISOString(),
                  workspace: workspaceRef.current,
                  unconfirmedReviewAttempt: pendingReviewRef.current,
                },
                null,
                2,
              ),
              "application/json",
            ),
          catch: () => ({ _tag: "WorkspaceSnapshotDownloadFailure" }) as const,
        }),
      ),
    );
    setImportNotice(
      Either.isLeft(exported)
        ? "This tab's snapshot could not be downloaded. Try exporting again before reloading."
        : "This tab's private JSON snapshot was exported with reviews and schedules. Attachment bytes are included only in ZIP backups.",
    );
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
    const desktop = window.recallDesktop;
    if (desktop) {
      const saved = await desktop.backup.save(result.right);
      if (
        typeof saved === "object" &&
        saved !== null &&
        "_tag" in saved &&
        saved._tag === "Success" &&
        "value" in saved &&
        saved.value === true
      ) {
        setImportNotice(
          "Private backup exported with review history, schedules, and attached media.",
        );
      } else if (
        typeof saved === "object" &&
        saved !== null &&
        "_tag" in saved &&
        saved._tag === "Success" &&
        "value" in saved &&
        saved.value === false
      ) {
        setImportNotice("Backup export was canceled.");
      } else {
        setImportNotice("The private backup could not be saved.");
      }
      return;
    }
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
    await restoreWorkspaceBackupFile(file);
  }

  async function restoreWorkspaceBackupFile(file: File) {
    if (file.size > 100_000_000) {
      setImportNotice("Workspace backup packages must be 100 MB or smaller.");
      return;
    }
    if (file.name.toLowerCase().endsWith(".zip")) {
      if (!beginContentImport()) return;
      const imported = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => file.arrayBuffer(),
            catch: () => ({ _tag: "WorkspaceBackupReadFailure" }) as const,
          }).pipe(Effect.flatMap((buffer) => importWorkspaceBackupPackage(new Uint8Array(buffer)))),
        ),
      );
      if (Either.isLeft(imported)) {
        failContentImport("That private backup is invalid, too large, or has missing media.");
        return;
      }
      if (!cardEditorMounted.current) return;
      if (!window.confirm("Replace this device’s current workspace with the selected backup?")) {
        failContentImport("Backup restore cancelled. Your workspace is unchanged.");
        return;
      }
      const prepared = prepareWorkspaceForSync(imported.right.workspace, () => crypto.randomUUID());
      await commitContentImport({
        replacement: prepared,
        expectedWorkspace: workspaceRef.current,
        media: imported.right.media,
        message: "Private backup restored with review history, schedules, and media.",
      });
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
    const restoredWorkspace: Workspace = restoredResult.right;
    if (
      [...restoredWorkspace.areas, ...(restoredWorkspace.retainedReviewAreas ?? [])].some((item) =>
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
    if (!beginContentImport()) return;
    await commitContentImport({
      replacement: prepared,
      expectedWorkspace: workspaceRef.current,
      message: "Private workspace backup restored on this device.",
    });
  }

  async function restoreDesktopWorkspaceBackup() {
    const opened = await window.recallDesktop?.backup.open();
    if (
      typeof opened !== "object" ||
      opened === null ||
      !("_tag" in opened) ||
      opened._tag !== "Success" ||
      !("value" in opened)
    ) {
      setImportNotice("The selected backup could not be read.");
      return;
    }
    const value: unknown = opened.value;
    if (value === null) return;
    if (
      typeof value !== "object" ||
      value === null ||
      !("name" in value) ||
      typeof value.name !== "string" ||
      !("bytes" in value) ||
      !(value.bytes instanceof Uint8Array)
    ) {
      setImportNotice("The selected backup could not be read.");
      return;
    }
    const fileBytes = new ArrayBuffer(value.bytes.byteLength);
    new Uint8Array(fileBytes).set(value.bytes);
    const file = new File([fileBytes], value.name);
    await restoreWorkspaceBackupFile(file);
  }

  function importDelimited(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setImportNotice("CSV and TSV files must be 2 MB or smaller.");
      return;
    }
    if (!beginContentImport()) return;
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
          new Date(),
        ),
      ),
      Effect.match({
        onFailure: () => failContentImport("The selected file could not be read."),
        onSuccess: (result) => {
          if (result._tag === "Failure") {
            const messages = {
              "invalid-quote": "The CSV/TSV has invalid quoted fields.",
              "too-many-rows":
                "CSV/TSV imports are limited to 500 card rows plus an optional header.",
              "too-many-columns": "CSV/TSV imports are limited to 30 columns.",
              "field-too-large": "CSV/TSV fields are limited to 1 MB.",
              "input-too-large": "CSV/TSV imports are limited to 2 MB.",
              "missing-front-back":
                "Include front and back columns, or two columns without a header. Every non-empty row needs both a question and an answer; no cards were imported.",
              "no-cards": "No non-empty front/back card rows were found.",
              "too-many-cards": "A Knowledge Area can contain up to 500 cards.",
              "too-many-objectives": "A Knowledge Area can contain up to 200 learning objectives.",
              "invalid-metadata":
                "Rename the import file to use a title of 80 characters or fewer and select a valid area color.",
              "invalid-content":
                "The imported content could not be validated as a portable Knowledge Area.",
              "invalid-tag-encoding":
                "The tags_json column must contain a JSON array of valid tag text. Correct it before importing.",
              "identity-unavailable": "Card identifiers could not be created. Try importing again.",
              "invalid-timestamp": "The import time is invalid. Try importing again.",
            } as const;
            failContentImport(messages[result.reason]);
            return;
          }
          void commitContentImport({
            area: result.area,
            message: `${result.area.cards.length} cards imported from ${file.name}.`,
          });
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

    if (!beginContentImport()) return;

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
          new Date(),
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
          failContentImport(message);
        },
        onSuccess: (imported) => {
          void commitContentImport({
            area: imported,
            message: `${imported.title} imported. Review schedules were initialized for this learner.`,
          });
        },
      }),
    );
    Effect.runFork(program);
  }

  function importAreaPackage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_KNOWLEDGE_AREA_PACKAGE_BYTES) {
      setImportNotice("Knowledge Area media packages must be 25 MB or smaller.");
      return;
    }
    if (!beginContentImport()) return;
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
          new Date(),
          true,
        ).pipe(Effect.map((importedArea) => ({ importedArea, media: pack.media }))),
      ),
      Effect.match({
        onFailure: () =>
          failContentImport("That ZIP is invalid, too large, or contains unsupported media."),
        onSuccess: ({ importedArea, media }) => {
          void commitContentImport({
            area: importedArea,
            media,
            message: `${importedArea.title} and its verified media were imported.`,
          });
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
            <button className="icon-button" aria-label="Add learning area" onClick={addArea}>
              ＋
            </button>
          </div>
          {workspace.areas.map((item) => (
            <button
              key={item.id}
              disabled={reviewSaving || reviewSaveFailed}
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
          <button className="add-area" onClick={addArea}>
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
              demoMissingReviewContent={demo?.missingReviewContent ?? false}
              onMissingReviewContent={() => {
                setMissingDeletedReviewContent(true);
                setDeletedReviewProvisionCapacity(false);
              }}
              onReviewProvisionCapacity={() => {
                setDeletedReviewProvisionCapacity(true);
                setMissingDeletedReviewContent(false);
              }}
              {...(demo?.syncAccountState ? { demoAccountState: demo.syncAccountState } : {})}
              onExportOffline={() => void exportWorkspaceBackup()}
              onClearWorkspace={() => void discardSavedWorkspace()}
              checkpoint={(candidate) =>
                Effect.tryPromise({
                  try: () =>
                    enqueueWorkspaceSave(async () => {
                      for (;;) {
                        if (!ready || !cacheWritable || localWritesBlocked())
                          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
                        const current = workspaceRef.current;
                        const bound = await Effect.runPromise(
                          Effect.either(
                            bindWorkspaceOwner(
                              current,
                              candidate.syncOwnerId,
                              workspaceHasRemoteSyncMetadata(candidate),
                            ),
                          ),
                        );
                        if (Either.isLeft(bound))
                          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
                        const persisted = await Effect.runPromise(
                          Effect.either(saveWorkspace(browserWorkspaceStore, bound.right)),
                        );
                        if (Either.isLeft(persisted))
                          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
                        if (localWritesBlocked())
                          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
                        if (workspaceRef.current !== current) continue;
                        setWorkspace(bound.right);
                        return Either.right(bound.right);
                      }
                    }),
                  catch: (): WorkspaceSyncCheckpointFailure => ({
                    _tag: "WorkspaceSyncCheckpointFailure",
                  }),
                }).pipe(Effect.flatMap((result) => result))
              }
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
                hasMore,
                uploadDeferred,
                baseline,
              ) => {
                if (localWritesBlocked()) return null;
                const applied = Effect.runSync(
                  Effect.either(
                    applyWorkspaceSyncChanges(
                      workspaceRef.current,
                      {
                        baseline,
                        acceptedIds,
                        cursor,
                        pulledEvents,
                        pulledAreas,
                        deletedCardIds,
                        syncedAreaTombstoneIds,
                        pulledDeletedAreaIds,
                        contentHashes,
                        conflicts,
                        hasMore,
                        uploadDeferred,
                      },
                      () => crypto.randomUUID(),
                    ),
                  ),
                );
                if (Either.isLeft(applied)) {
                  setImportNotice(
                    "Synced changes could not be reconciled. Your latest local workspace was preserved.",
                  );
                  return null;
                }
                setWorkspace(applied.right);
                setMissingDeletedReviewContent(false);
                setDeletedReviewProvisionCapacity(false);
                return applied.right;
              }}
              onContentConflict={(ownerId, remoteAreas, contentHashes, deletedAreaIds) => {
                if (reviewingRef.current || pendingReviewRef.current) return false;
                const preview = {
                  ownerId,
                  areas: remoteAreas,
                  hashes: contentHashes,
                  deletedAreaIds,
                };
                const preflight = Effect.runSync(
                  Effect.either(applyWorkspaceContentConflict(workspace, preview)),
                );
                if (Either.isLeft(preflight)) return false;
                setWorkspace((current) => {
                  if (current === workspace) return preflight.right;
                  const applied = Effect.runSync(
                    Effect.either(applyWorkspaceContentConflict(current, preview)),
                  );
                  return Either.isRight(applied) ? applied.right : current;
                });
                return true;
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
              <i />{" "}
              {erased || stale
                ? "Read-only on this device"
                : reviewSaving
                  ? "Saving review…"
                  : reviewSaveFailed
                    ? "Review save needs retry"
                    : "Saved on this device"}
            </span>
            <button className="help-button" aria-label="Help">
              ?
            </button>
          </div>
        </header>
        {stale && !erased && (
          <div className="notice-bar" role="alert">
            Another tab saved a newer workspace. This tab is read-only; your unsaved changes are
            still here. Export them before reloading the latest saved workspace.
            <button className="notice-action" onClick={() => void exportWorkspaceBackup()}>
              Export this tab backup
            </button>
            <button className="notice-action" onClick={() => exportWorkspaceSnapshot()}>
              Export JSON snapshot
            </button>
            <button
              className="notice-action"
              onClick={() => {
                if (!demo) window.location.reload();
              }}
            >
              Reload latest saved workspace
            </button>
          </div>
        )}
        {(contentImportBusy || pendingContentImport) && (
          <div className="notice-bar" role={contentImportBusy ? "status" : "alert"}>
            {contentImportBusy
              ? "Saving imported content…"
              : "This import has not been confirmed saved. Its content is retained on this page."}
            {!contentImportBusy && pendingContentImport && (
              <>
                <button
                  className="notice-action"
                  onClick={() => {
                    if (
                      !pendingContentImport.replacement ||
                      window.confirm(
                        "Replace the current workspace with this backup? Changes made since the earlier attempt will be replaced.",
                      )
                    )
                      void commitContentImport({
                        ...pendingContentImport,
                        expectedWorkspace: workspaceRef.current,
                      });
                  }}
                >
                  Retry saving import
                </button>
                <button
                  className="notice-action"
                  onClick={() => {
                    setPendingContentImport(null);
                    setImportNotice("Import cancelled. Your current workspace remains available.");
                  }}
                >
                  Cancel import
                </button>
              </>
            )}
          </div>
        )}
        {(importNotice || erased) && (
          <div className="notice-bar" role="status">
            {erased
              ? "This device is read-only while local data is being cleared. Retry clearing saved data if cleanup fails."
              : importNotice}
            {cacheBlocked && !stale && (
              <button className="notice-action" onClick={() => void discardSavedWorkspace()}>
                Clear saved data
              </button>
            )}
            <button aria-label="Dismiss notice" onClick={() => setImportNotice(null)}>
              ×
            </button>
          </div>
        )}
        {reviewSaveFailed && (
          <div className="notice-bar" role="alert">
            This review has not been confirmed saved. The answer is still here; retry saving the
            same review before continuing. Other saves are paused so a pending review cannot be
            overwritten.
            <button
              className="notice-action"
              disabled={erased || stale}
              onClick={() => {
                const rating = pendingReviewRef.current?.rating ?? "good";
                void review(rating);
              }}
            >
              Retry review save
            </button>
            <button className="notice-action" onClick={exportWorkspaceSnapshot}>
              Export this tab snapshot
            </button>
            <button className="notice-action" onClick={() => void exportWorkspaceBackup()}>
              Export saved attachments backup
            </button>
          </div>
        )}

        {(libraryMutation === "area-delete" || libraryMutation === "card-delete") && (
          <div className="notice-bar" role="status">
            Saving deletion on this device… The content remains available until saving completes.
          </div>
        )}
        {deletionRequest && libraryMutation === null && (
          <div className="notice-bar" role="alert">
            <span>{deletionRequest.error}</span>
            <button className="notice-action" onClick={() => void retryDeletion()}>
              {deletionRequest.stale
                ? "Review and confirm latest deletion"
                : "Retry saved deletion request"}
            </button>
            <button className="notice-action" onClick={() => setDeletionRequest(null)}>
              Cancel deletion request
            </button>
          </div>
        )}

        {activeView === "Today" ? (
          <>
            <div className="content-wrap" inert={reviewSaving || reviewSaveFailed}>
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
                  <p>reviews completed today</p>
                  <span className="summary-foot">{totalReviews} reviews all time</span>
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
                        className="text-button"
                        onClick={() => {
                          setActiveView("Explore");
                          setShowAreaSettings(true);
                        }}
                      >
                        Learning goals & AI
                      </button>
                      <button
                        className="text-button danger-text-button"
                        onClick={() => void deleteArea(area)}
                      >
                        Delete selected area
                      </button>
                    </>
                  )}
                  <button className="text-button" onClick={addArea}>
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
                        {item.objectives?.length ??
                          new Set(item.cards.map((entry) => entry.objective)).size}{" "}
                        learning goals
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
                <button className="new-learning-card" onClick={addArea}>
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
                  keyboardActive={
                    !addingArea &&
                    !addingCard &&
                    !showAreaSettings &&
                    !reviewSaving &&
                    !reviewSaveFailed &&
                    !erased &&
                    !stale
                  }
                  disabled={
                    reviewSaving ||
                    reviewSaveFailed ||
                    erased ||
                    stale ||
                    (!demo && (!ready || !cacheMayWrite))
                  }
                  saving={reviewSaving}
                  onReveal={() => setShowAnswer(true)}
                  onRate={(rating) => void review(rating)}
                  onEdit={editCard}
                  onDelete={(target) => void deleteCard(target)}
                  onAddCard={addCard}
                />
                <div className="study-aside">
                  <div className="aside-note">
                    <span className="note-icon">✦</span>
                    <h3>Make it yours.</h3>
                    <p>Add your own questions to build a study set that fits the way you learn.</p>
                    <button onClick={addCard}>＋ Add a card</button>
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
                      key={area.id}
                      knowledgeArea={tutorAreaDocument.right}
                      objectiveGaps={objectiveGaps}
                      onApprove={async (
                        proposal: CardProposal,
                        _cardId: string,
                        proposalId: string,
                        sessionId: string,
                      ) => {
                        if (!cacheWritable || !ready) {
                          setImportNotice(
                            "Local storage must be available before approving an AI card.",
                          );
                          return null;
                        }
                        return enqueueWorkspaceSave(async () => {
                          for (;;) {
                            const current = workspaceRef.current;
                            const saved = await Effect.runPromise(
                              Effect.either(
                                persistTutorCardApproval(
                                  browserWorkspaceStore,
                                  current,
                                  {
                                    areaId: area.id,
                                    proposal,
                                    proposalId,
                                    sessionId,
                                  },
                                  new Date(),
                                ),
                              ),
                            );
                            if (Either.isLeft(saved)) {
                              setImportNotice(saved.left.message);
                              return null;
                            }
                            if (workspaceRef.current !== current) continue;
                            setWorkspace(saved.right.workspace);
                            setImportNotice(
                              "AI card saved to your study queue. Approval can be retried without creating another card.",
                            );
                            return saved.right.proposal;
                          }
                        });
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
          <div className="content-wrap alternate-view" inert={reviewSaving || reviewSaveFailed}>
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
                <Button size="small" className="primary-action" onClick={addArea}>
                  ＋ Create a learning area
                </Button>
                {area && (
                  <>
                    <div className="section-title-row">
                      <h2>{area.title}</h2>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setShowAreaSettings((current) => !current)}
                      >
                        {showAreaSettings
                          ? "Close area settings"
                          : "Edit learning goals & AI instructions"}
                      </button>
                    </div>
                    {showAreaSettings && (
                      <KnowledgeAreaSettings
                        key={area.id}
                        area={area}
                        readLatest={() =>
                          workspaceRef.current.areas.find((item) => item.id === area.id) ?? null
                        }
                        onSave={(settings, expectedBaseline) =>
                          saveAuthoringCommand(
                            { kind: "update-area-settings", areaId: area.id, settings },
                            expectedBaseline,
                          ).pipe(
                            Effect.flatMap((saved) => {
                              const updated = saved.areas.find((item) => item.id === area.id);
                              return updated
                                ? Effect.succeed(updated)
                                : Effect.fail({
                                    reason: "unavailable" as const,
                                    message:
                                      "This knowledge area is no longer available. Your draft is preserved.",
                                  });
                            }),
                            Effect.mapError((error) => ({
                              ...error,
                              _tag: "AreaSettingsSaveFailure" as const,
                            })),
                          )
                        }
                      />
                    )}
                    <KnowledgeAreaCardLibrary
                      key={area.id}
                      area={area}
                      onEdit={editCard}
                      onDelete={(target) => void deleteCard(target)}
                      onAdd={addCard}
                    />
                  </>
                )}
                <div className="interchange-tools" aria-label="Import and export tools">
                  <AnkiImportAction
                    color={colors[workspace.areas.length % colors.length] ?? "#c4ed68"}
                    onAccept={(proposal) =>
                      Effect.tryPromise({
                        try: async () => {
                          if (
                            contentImportPending.current ||
                            (pendingContentImport &&
                              pendingContentImport.area?.id !== proposal.area.id)
                          )
                            return false;
                          return commitContentImport({
                            area: proposal.area,
                            media: proposal.media,
                            reviewEvents: proposal.reviewEvents,
                            message: `${proposal.area.cards.length} cards and ${proposal.reviewEvents.length} reviews imported from Anki. FSRS schedules were rebuilt from the review history.`,
                          });
                        },
                        catch: () => ({ _tag: "AnkiImportAcceptanceUnavailable" }) as const,
                      }).pipe(
                        Effect.flatMap((saved) =>
                          saved
                            ? Effect.void
                            : Effect.fail({ _tag: "AnkiImportNotSaved" } as const),
                        ),
                      )
                    }
                  />
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
                  <label
                    className="text-button import-control"
                    htmlFor={isDesktopRuntime() ? undefined : "workspace-backup-import"}
                    onClick={isDesktopRuntime() ? restoreDesktopWorkspaceBackup : undefined}
                  >
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
                <KnowledgeAreaPublishing
                  key={area?.id ?? "receive-shared-area"}
                  area={
                    publishingAreaDocument && Either.isRight(publishingAreaDocument)
                      ? publishingAreaDocument.right
                      : null
                  }
                  {...(lineageAreaDocument && Either.isRight(lineageAreaDocument)
                    ? { lineageArea: lineageAreaDocument.right }
                    : {})}
                  {...(sharedRequest ? { initialRequest: sharedRequest } : {})}
                  onFork={async (
                    document,
                    attribution,
                    license,
                    forkedFromVersionId,
                    contentHash,
                    assets,
                  ) => {
                    if ((!cacheWritable || !ready || localWritesBlocked()) && !demo) return false;
                    return enqueueWorkspaceSave(async () => {
                      for (;;) {
                        if (
                          localWritesBlocked() ||
                          localSnapshotStale() ||
                          pendingReviewRef.current
                        )
                          return false;
                        const current = workspaceRef.current;
                        const existing = current.areas.find((item) => item.id === document.id);
                        if (existing) {
                          if (existing.forkedFromVersionId !== forkedFromVersionId) return false;
                          if (!demo) {
                            const requiredMedia = new Set(
                              existing.cards.flatMap((card) =>
                                (card.media ?? []).map((reference) => reference.id),
                              ),
                            );
                            const saved = await Effect.runPromise(
                              Effect.either(
                                saveWorkspaceWithMedia(
                                  browserWorkspaceStore,
                                  browserMediaStore,
                                  current,
                                  assets.filter((asset) => requiredMedia.has(asset.reference.id)),
                                ),
                              ),
                            );
                            if (Either.isLeft(saved)) {
                              setImportNotice(
                                "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
                              );
                              return false;
                            }
                          }
                          if (
                            localWritesBlocked() ||
                            localSnapshotStale() ||
                            pendingReviewRef.current
                          )
                            return false;
                          if (workspaceRef.current !== current) continue;
                          setSelectedId(existing.id);
                          setActiveView("Today");
                          return true;
                        }
                        const imported = Effect.runSync(
                          Effect.either(
                            fromKnowledgeArea(
                              { ...document, licence: license, attribution, forkedFromVersionId },
                              colors[current.areas.length % colors.length] ?? "#c4ed68",
                              true,
                              () => crypto.randomUUID(),
                              new Date(),
                              true,
                            ),
                          ),
                        );
                        if (Either.isLeft(imported)) return false;
                        const next = {
                          ...current,
                          areas: [...current.areas, imported.right],
                          syncContentHashes: {
                            ...(current.syncContentHashes ?? {}),
                            [imported.right.id]: contentHash,
                          },
                        };
                        if (!demo) {
                          const saved = await Effect.runPromise(
                            Effect.either(
                              saveWorkspaceWithMedia(
                                browserWorkspaceStore,
                                browserMediaStore,
                                next,
                                assets,
                              ),
                            ),
                          );
                          if (Either.isLeft(saved)) {
                            setImportNotice(
                              "Your cloud copy is saved, but local storage failed. Retry to receive the same copy.",
                            );
                            return false;
                          }
                        }
                        if (
                          localWritesBlocked() ||
                          localSnapshotStale() ||
                          pendingReviewRef.current
                        )
                          return false;
                        if (workspaceRef.current !== current) continue;
                        setWorkspace(next);
                        setSelectedId(imported.right.id);
                        setActiveView("Today");
                        setImportNotice(
                          `${imported.right.title} added as your copy. Attribution and license are preserved.`,
                        );
                        return true;
                      }
                    });
                  }}
                />
              </>
            ) : (
              <>
                <div className="insight-panel">
                  <strong>{totalReviews}</strong>
                  <span>reviews completed all time</span>
                  <p>
                    {dueCount} cards are ready across {workspace.areas.length} learning areas.
                  </p>
                  <p>
                    {studiedToday} today · {practice.week.inWindow} in the last 7 calendar days
                  </p>
                  <p>
                    Last 7 days: {practice.week.ratings.again} Again · {practice.week.ratings.hard}{" "}
                    Hard · {practice.week.ratings.good} Good · {practice.week.ratings.easy} Easy
                  </p>
                </div>
                <SchedulerSettings
                  workspace={workspace}
                  readLatest={() => workspaceRef.current}
                  onSave={(settings, expectedBaseline) =>
                    saveAuthoringCommand(
                      { kind: "update-scheduler-settings", settings },
                      expectedBaseline,
                    ).pipe(
                      Effect.mapError((error) => ({
                        ...error,
                        _tag: "SchedulerSettingsSaveFailure" as const,
                      })),
                    )
                  }
                />
                {(retainedCards > 0 ||
                  missingDeletedReviewContent ||
                  deletedReviewProvisionCapacity) && (
                  <section className="insight-panel" aria-labelledby="deleted-review-sync-title">
                    <h2 id="deleted-review-sync-title">Deleted content awaiting sync</h2>
                    {retainedCards > 0 && (
                      <>
                        <p>
                          {retainedCards} deleted card{retainedCards === 1 ? "" : "s"}
                          {deletedRetainedAreas > 0
                            ? ` in ${deletedRetainedAreas} deleted area${deletedRetainedAreas === 1 ? "" : "s"}`
                            : ""}{" "}
                          {retainedPendingReviews > 0
                            ? `retained privately for ${retainedPendingReviews} pending review${retainedPendingReviews === 1 ? "" : "s"}.`
                            : "retained privately until deletion acknowledgements arrive."}
                        </p>
                        <p>
                          These cards stay out of your library and study queue. Sync preserves their
                          reviews before confirming the deletions, then releases the retained
                          content.
                        </p>
                      </>
                    )}
                    {missingDeletedReviewContent && (
                      <p role="alert">
                        This older workspace has a pending review whose deleted card is missing.
                        Export this device&apos;s current private backup or review snapshot before
                        replacing it with an older backup containing that card. Backups are not
                        automatically merged; your review history remains saved.
                      </p>
                    )}
                    {deletedReviewProvisionCapacity && (
                      <p role="alert">
                        Cloud content and pending deleted-review content exceed this area&apos;s
                        card or objective limits. Local cards and reviews remain saved. Export a
                        private backup before changing cloud content to free capacity.
                      </p>
                    )}
                    <button className="text-button" onClick={exportWorkspaceSnapshot}>
                      Export private recovery snapshot
                    </button>
                    {missingDeletedReviewContent && (
                      <button className="text-button" onClick={() => setActiveView("Explore")}>
                        Open backup restore tools
                      </button>
                    )}
                    {deletedReviewProvisionCapacity && (
                      <>
                        <button
                          className="text-button"
                          onClick={() => void exportWorkspaceBackup()}
                        >
                          Export private backup
                        </button>
                        <button className="text-button" onClick={() => setActiveView("Explore")}>
                          Open area library
                        </button>
                      </>
                    )}
                  </section>
                )}
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
                            {event.retainedForSync && (
                              <StatusBadge tone="warning">Deleted · sync pending</StatusBadge>
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
                    setShowAnswer(false);
                    if (activeView !== "Explore") setActiveView("Today");
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
          <form className="modal" aria-busy={libraryMutation === "area-save"} onSubmit={createArea}>
            <button
              className="modal-close"
              type="button"
              disabled={libraryMutation === "area-save"}
              onClick={closeAreaEditor}
            >
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
            {areaEditorError && (
              <div role="alert">
                <p>{areaEditorError}</p>
                {areaDraftStale && editingAreaId && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={libraryMutation !== null}
                    onClick={() => {
                      const latest = workspaceRef.current.areas.find(
                        (item) => item.id === editingAreaId,
                      );
                      if (
                        latest &&
                        window.confirm(
                          "Replace this draft with the latest saved area name and color? Copy any text you want to keep first.",
                        )
                      )
                        editArea(latest);
                    }}
                  >
                    Reopen latest saved area
                  </button>
                )}
              </div>
            )}
            <fieldset
              disabled={libraryMutation === "area-save"}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
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
                  disabled={libraryMutation === "area-save" || !areaTitle.trim()}
                >
                  {libraryMutation === "area-save"
                    ? "Saving area…"
                    : editingAreaId
                      ? "Save changes"
                      : "Create area"}
                </Button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      )}
      {addingCard && (
        <Dialog labelledBy="card-dialog-title" onClose={closeCardEditor}>
          <form className="modal" onSubmit={createCard}>
            <button
              className="modal-close"
              type="button"
              disabled={cardSaving}
              onClick={closeCardEditor}
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
            {cardEditorError && (
              <div role="alert">
                <p>{cardEditorError}</p>
                {cardDraftStale && editingCardId && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={cardSaving}
                    onClick={() => {
                      const latest = workspaceRef.current.areas
                        .flatMap((item) => item.cards)
                        .find((item) => item.id === editingCardId);
                      if (
                        latest &&
                        window.confirm(
                          "Replace this draft with the latest saved card? Copy any text you want to keep first.",
                        )
                      )
                        editCard(latest);
                    }}
                  >
                    Reopen latest saved card
                  </button>
                )}
              </div>
            )}
            <fieldset
              disabled={cardSaving}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <label htmlFor="card-kind">Card type</label>
              <select
                id="card-kind"
                value={cardKind}
                onChange={(event) =>
                  setCardKind(event.target.value === "cloze" ? "cloze" : "basic")
                }
              >
                <option value="basic">Question and answer</option>
                <option value="cloze">Cloze · fill the gap</option>
              </select>
              {cardKind === "basic" ? (
                <>
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
                </>
              ) : (
                <>
                  <label htmlFor="card-cloze-text">Cloze text</label>
                  <textarea
                    id="card-cloze-text"
                    autoFocus
                    value={clozeText}
                    onChange={(event) => setClozeText(event.target.value)}
                    maxLength={10000}
                    rows={5}
                    placeholder="Mitochondria produce {{c1::ATP::energy molecule}}."
                  />
                  <p className="modal-copy">
                    Wrap an answer like {"{{c1::ATP::energy molecule}}"}. Matching numbers hide
                    together; other numbers remain visible.
                  </p>
                  <label htmlFor="card-cloze-index">Deletion number to study</label>
                  <input
                    id="card-cloze-index"
                    type="number"
                    min={1}
                    max={20}
                    value={clozeIndex}
                    onChange={(event) => setClozeIndex(event.target.value)}
                  />
                  {clozePreview && Either.isRight(clozePreview) ? (
                    <section aria-label="Cloze card preview">
                      <strong>Question preview</strong>
                      <p style={{ whiteSpace: "pre-wrap" }}>{clozePreview.right.front}</p>
                      <strong>Answer preview</strong>
                      <p style={{ whiteSpace: "pre-wrap" }}>{clozePreview.right.back}</p>
                    </section>
                  ) : (
                    <p role="status">
                      Add a valid deletion matching the selected number to preview this card.
                    </p>
                  )}
                </>
              )}
              {(area?.objectives?.length ?? 0) > 0 && (
                <fieldset>
                  <legend>Learning objectives</legend>
                  {area?.objectives?.map((objective) => (
                    <label
                      key={objective.id}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <input
                        type="checkbox"
                        checked={cardObjectiveIds.includes(objective.id)}
                        onChange={(event) =>
                          setCardObjectiveIds((current) =>
                            event.target.checked
                              ? [...current, objective.id]
                              : current.filter((id) => id !== objective.id),
                          )
                        }
                      />
                      {objective.title}
                    </label>
                  ))}
                </fieldset>
              )}
              <label htmlFor="card-tags">Tags</label>
              <textarea
                rows={2}
                id="card-tags"
                aria-describedby="card-tags-help"
                value={cardTags}
                onChange={(event) => setCardTags(event.target.value)}
                placeholder="e.g. exam, fundamentals"
              />
              <small id="card-tags-help">
                Separate with commas; quote a tag containing commas, double embedded quotes.
              </small>
              {(cardEditor.current.sourceCard?.media ?? [])
                .filter((reference) => !removedMediaIds.includes(reference.id))
                .map((reference, index) => (
                  <div
                    key={reference.id}
                    style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                  >
                    <span>
                      Attachment {index + 1} · {reference.mimeType}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setRemovedMediaIds((current) => [...current, reference.id])}
                    >
                      Remove attachment
                    </button>
                  </div>
                ))}
              <label htmlFor="card-media">Attach image or audio (20 MB max)</label>
              <input
                id="card-media"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav"
                onChange={(event) => setMediaFile(event.currentTarget.files?.[0] ?? null)}
              />
              {mediaFile && <MediaFilePreview file={mediaFile} />}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={closeCardEditor}>
                  Cancel
                </button>
                <Button
                  size="small"
                  className="primary-action"
                  type="submit"
                  disabled={
                    cardSaving ||
                    (cardKind === "cloze"
                      ? !clozePreview || Either.isLeft(clozePreview)
                      : !front.trim() || !back.trim())
                  }
                >
                  {cardSaving ? "Saving card…" : editingCardId ? "Save changes" : "Add card"}
                </Button>
              </div>
            </fieldset>
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
