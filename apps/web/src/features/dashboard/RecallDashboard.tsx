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
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  MediaReferenceSchema,
  WorkspaceSchema,
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type AreaId,
  parseWorkspaceJson,
  type MediaReference,
  type ReviewEvent,
  type AssessmentSchedule,
  type CardVersion,
} from "@recall/domain";
import { rebuildScheduleEffect, type ReviewRating } from "@recall/scheduler";
import { orderReviewEvents } from "@recall/sync-core";
import {
  applyWorkspaceAuthoringCommand,
  refinementCardContent,
  type WorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
  formatTagInput,
  parseTagInput,
  persistTutorCardApproval,
  exportDelimitedCards,
  importDelimitedCards,
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
  workspaceDuplicateCandidates,
  findCardDuplicates,
  cardVersionRestoresAsCopy,
  type WorkspaceSearchResult,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import { mockWorkspace } from "@/features/workspace/mock-data";
import {
  DashboardView,
  dashboardNavigationItems,
  type DashboardView as DashboardViewValue,
} from "@/features/dashboard/dashboard-navigation";
import { type LearningArea, type Assessment, type Workspace } from "@/features/workspace/types";
import { fromKnowledgeArea, toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { Button } from "@/components/ui/Button";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { InlineImage } from "@/components/ui/InlineImage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { toast } from "@recall/ui-web";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@recall/ui-web/components/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { Alert } from "@recall/ui-web/components/alert";
import { Input } from "@recall/ui-web/components/input";
import { Textarea } from "@recall/ui-web/components/textarea";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { RadioGroup, RadioGroupItem } from "@recall/ui-web/components/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@recall/ui-web/components/popover";
import { EmptyState } from "@/components/ui/EmptyState";
import { StudyAreaSelect } from "@/components/workspace/StudyAreaSelect";
import { DailyReminderSettingsPanel } from "@/components/auth/DailyReminderSettingsPanel";
import { startDailyReminderRuntime } from "@/lib/daily-reminder-api";
import { AccountAction } from "@/components/auth/AccountAction";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
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
import { CardAssistancePanel } from "@/components/tutor/CardAssistancePanel";
import {
  identifyObjectiveGaps,
  type CardProposal,
  type CardRefinementResult,
} from "@recall/ai-core";
import { KnowledgeAreaPublishing } from "@/components/publishing/KnowledgeAreaPublishing";
import { AnkiImportAction } from "@/features/interchange/AnkiImportAction";
import { KnowledgeAreaCardLibrary } from "@/components/knowledge/KnowledgeAreaCardLibrary";
import {
  CardDuplicateWarnings,
  cardDuplicateAcknowledgementKey,
} from "@/components/knowledge/CardDuplicateWarnings";
import { DeletedCardRecovery } from "@/components/knowledge/DeletedCardRecovery";
import { WorkspaceSearchPanel } from "@/components/search/WorkspaceSearchPanel";
import { KnowledgeAreaSettings } from "@/components/knowledge/KnowledgeAreaSettings";
import { SchedulerSettings } from "@/components/knowledge/SchedulerSettings";
import { isDesktopRuntime } from "@/lib/desktop-api";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  Ellipsis,
  Plus,
  Pipette,
  Search,
  Settings2,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@recall/ui-web/components/sidebar";

const colors = [
  "#c4ed68",
  "#ffb29b",
  "#c4b5fd",
  "#f7cb70",
  "#7dd3fc",
  "#86efac",
  "#f9a8d4",
  "#fdba74",
  "#a5b4fc",
  "#5eead4",
  "#fca5a5",
  "#d9f99d",
];
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

function dueNow(card: Assessment, now: Date): boolean {
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
    <InlineImage
      className="max-h-[180px] max-w-[320px] rounded-md object-contain"
      src={url}
      alt="Selected card attachment preview"
      width={320}
      height={180}
    />
  ) : (
    <audio controls src={url} aria-label="Selected audio preview" />
  );
}

type StoryDemo = {
  workspace: Workspace;
  view?: DashboardViewValue;
  selectedAreaId?: string;
  editAreaId?: string;
  areaDraft?: LearningArea;
  areaEditFailure?: "stale-content" | "storage";
  deletionFailure?: "area" | "card";
  editCardId?: string;
  cardDraft?: Assessment;
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

function cardEditingBaseline(workspace: Workspace, area: LearningArea, card: Assessment) {
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
  "This area could not be kept in the current tab. Your draft is preserved; reconnect to the account server and retry.";
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
  readonly schedule?: AssessmentSchedule;
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
  routeView,
  onViewChange,
  practiceId,
  onPracticeChange,
}: {
  readonly demo?: StoryDemo;
  readonly sharedRequest?: { readonly versionId: string; readonly token?: string };
  readonly routeView?: DashboardViewValue;
  readonly onViewChange?: (view: DashboardViewValue) => void;
  readonly practiceId?: string;
  readonly onPracticeChange?: (id: string) => void;
}) {
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    readonly description: string;
    readonly onConfirm: () => void | Promise<unknown>;
    readonly onCancel?: () => void;
  } | null>(null);
  const requestConfirmation = (
    description: string,
    onConfirm: () => void | Promise<unknown>,
    onCancel?: () => void,
  ) => setPendingConfirmation({ description, onConfirm, ...(onCancel ? { onCancel } : {}) });
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
  const [cloudWorkspaceLoaded, setCloudWorkspaceLoaded] = useState(false);
  const [accountStatus, setAccountStatus] = useState<
    "checking" | "signed-in" | "signed-out" | "unavailable"
  >(demo || isDesktopRuntime() ? "signed-in" : "checking");
  const checkAccount = useCallback(() => {
    if (demo || isDesktopRuntime()) {
      setAccountStatus("signed-in");
      return;
    }
    void Effect.runPromise(Effect.either(readBrowserSession())).then((result) => {
      if (Either.isLeft(result)) {
        setCloudWorkspaceLoaded(false);
        setAccountStatus("unavailable");
      } else {
        setAccountStatus(result.right.authenticated ? "signed-in" : "signed-out");
        if (!result.right.authenticated) setCloudWorkspaceLoaded(false);
      }
    });
  }, [demo]);
  useEffect(() => {
    checkAccount();
    const refresh = () => checkAccount();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [checkAccount]);
  const workspaceUnlocked =
    Boolean(demo) || isDesktopRuntime() || (accountStatus === "signed-in" && cloudWorkspaceLoaded);
  const webAccountConfigured = Either.isRight(readSupabaseConfig());
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
        "Deletion could not be kept in the current tab. The content and review history remain available; reconnect and retry.",
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
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const [cardKind, setCardKind] = useState<"basic" | "cloze">(demoCard?.cloze ? "cloze" : "basic");
  const [clozeText, setClozeText] = useState(demoCard?.cloze?.text ?? "");
  const [clozeIndex, setClozeIndex] = useState(String(demoCard?.cloze?.deletionIndex ?? 1));
  const [cardObjectiveIds, setCardObjectiveIds] = useState<readonly string[]>(
    demoCard?.objectiveIds ?? [],
  );
  const [cardTags, setCardTags] = useState(formatTagInput(demoCard?.tags ?? []));
  const [removedMediaIds, setRemovedMediaIds] = useState<readonly string[]>([]);
  const [showAreaSettings, setShowAreaSettings] = useState(demo?.areaSettings ?? false);
  const [shareKnowledgeOpen, setShareKnowledgeOpen] = useState(Boolean(sharedRequest));
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [reviewSettingsOpen, setReviewSettingsOpen] = useState(false);
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
    setActiveView(DashboardView.Today);
    setImportNotice(request.message);
    return true;
  }
  const [deviceSettings, setDeviceSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<WorkspaceSearchResult | null>(null);
  const [localActiveView, setLocalActiveView] = useState<DashboardViewValue>(
    routeView ?? demo?.view ?? (sharedRequest ? DashboardView.Library : DashboardView.Today),
  );
  const activeView = routeView ?? localActiveView;
  const setActiveView = useCallback(
    (view: DashboardViewValue) => {
      if (onViewChange) onViewChange(view);
      else setLocalActiveView(view);
    },
    [onViewChange],
  );
  useEffect(() => {
    if (demo) return;
    return startDailyReminderRuntime(() => setActiveView(DashboardView.Today));
  }, [demo, setActiveView]);
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
        if (!window.recallDesktop) {
          loaded = starter;
        } else if (Either.isLeft(loadResult)) {
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
        "This tab is read-only because its working copy could not be cleared. Retry clearing the tab before continuing.",
      );
      return;
    }
    window.location.reload();
  }

  const activeAreaId = practiceId ?? selectedId;
  const area = practiceId
    ? workspace.areas.find((item) => item.id === practiceId)
    : (workspace.areas.find((item) => item.id === selectedId) ?? workspace.areas[0]);
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
  const duplicateCandidates = useMemo(() => workspaceDuplicateCandidates(workspace), [workspace]);
  const duplicateDraft = {
    front: cardKind === "cloze" ? clozeText : front,
    back,
    ...(cardKind === "cloze" && clozePreview && Either.isRight(clozePreview)
      ? { cloze: { text: clozeText, deletionIndex: Number(clozeIndex) } }
      : {}),
  };
  const duplicateKey = cardDuplicateAcknowledgementKey(
    duplicateDraft,
    duplicateCandidates,
    editingCardId ?? undefined,
  );
  const duplicateMatches = findCardDuplicates(
    duplicateDraft,
    duplicateCandidates,
    editingCardId ? { excludeCardId: editingCardId } : {},
  );
  const duplicatesAccepted =
    duplicateMatches.length === 0 || duplicateAcknowledgement === duplicateKey;
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
  const objectiveGaps = useMemo(
    () => (area ? identifyObjectiveGaps(area, workspace.reviewEvents ?? [], now) : []),
    [area, now, workspace.reviewEvents],
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
        ? `${title} updated. Syncing to your account…`
        : `${title} created. Syncing to your account…`,
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
      `${request.label} was removed. Syncing the change and review history to your account…`,
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
    requestConfirmation(
      `Delete “${latest.title}” and its ${latest.cards.length} cards? Its review history will be retained in your account.`,
      () => commitDeletion({ command, baseline, label: latest.title, error: "", stale: false }),
    );
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
            "This change could not be kept in the current tab. Your draft or deletion request is preserved; reconnect and retry.",
        };
      }),
    );

  async function restoreVersion(version: CardVersion, expectedBaseline: string | undefined) {
    if (cardSavePending.current || libraryMutationPending.current) return false;
    cardSavePending.current = true;
    setCardSaving(true);
    const current = workspaceRef.current;
    const result = await Effect.runPromise(
      Effect.either(
        saveAuthoringCommand(
          {
            kind: "restore-card",
            areaId: version.areaId,
            cardId: version.cardId,
            versionId: version.id,
          },
          expectedBaseline,
        ),
      ),
    );
    cardSavePending.current = false;
    if (!cardEditorMounted.current) return false;
    setCardSaving(false);
    if (Either.isLeft(result)) {
      setImportNotice(result.left.message);
      return false;
    }
    const targetArea =
      result.right.areas.find((item) => item.id === version.areaId) ??
      result.right.areas.find((item) => !current.areas.some((previous) => previous.id === item.id));
    if (targetArea) setSelectedId(targetArea.id);
    setShowAnswer(false);
    setImportNotice(
      cardVersionRestoresAsCopy(current, version.areaId, version.cardId)
        ? "Card restored as a new copy. Previous reviews are preserved."
        : "Card restored.",
    );
    return true;
  }

  function openSearchResult(result: WorkspaceSearchResult) {
    if (
      reviewSaving ||
      reviewSaveFailed ||
      cardSavePending.current ||
      libraryMutationPending.current ||
      localWritesBlocked() ||
      localSnapshotStale()
    )
      return;
    const targetArea = workspaceRef.current.areas.find((item) => item.id === result.areaId);
    if (!targetArea) {
      setImportNotice("This search result is no longer available. Search again.");
      return;
    }
    if (addingCard || addingArea) {
      requestConfirmation("Discard the open draft and open this search result?", () => {
        openSearchResultAfterConfirmation(result, targetArea);
      });
      return;
    }
    openSearchResultAfterConfirmation(result, targetArea);
  }

  function openSearchResultAfterConfirmation(
    result: WorkspaceSearchResult,
    targetArea: LearningArea,
  ) {
    closeCardEditor();
    closeAreaEditor();
    setSearchOpen(false);
    setSelectedId(targetArea.id);
    setShowAnswer(false);
    setSearchTarget(result);
    if (result.target.kind === "card") {
      const targetId = result.target.cardId;
      const targetCard = targetArea.cards.find((item) => item.id === targetId);
      setActiveView(DashboardView.Library);
      if (targetCard) editCard(targetCard);
      else setImportNotice("This card is no longer available. Search again.");
    } else if (result.target.kind === "area" || result.target.kind === "objective") {
      setActiveView(DashboardView.Library);
      setShowAreaSettings(result.target.kind === "objective");
    } else setActiveView(DashboardView.Tutor);
  }

  async function applyCardRefinement(
    result: CardRefinementResult,
    mode: "wording" | "replace",
  ): Promise<boolean> {
    if (
      !area ||
      cardSavePending.current ||
      mediaFile ||
      localWritesBlocked() ||
      localSnapshotStale()
    )
      return false;
    const generation = cardEditor.current.generation;
    const tags = parseTagInput(cardTags);
    if (Either.isLeft(tags)) {
      setCardEditorError(tags.left.message);
      return false;
    }
    const metadata = {
      tags: tags.right,
      objectiveIds: cardObjectiveIds.map(createObjectiveId),
      media: (cardEditor.current.sourceCard?.media ?? []).filter(
        (item) => !removedMediaIds.includes(item.id),
      ),
    };
    const converted = Effect.runSync(
      Effect.either(Effect.all(result.cards.map((card) => refinementCardContent(card, metadata)))),
    );
    if (Either.isLeft(converted)) {
      setCardEditorError(converted.left.message);
      return false;
    }
    const first = converted.right[0];
    if (!first) return false;
    if (mode === "wording") {
      if (
        result.cards.length !== 1 ||
        result.cards[0]?.meaningChanged !== false ||
        first.kind !== cardKind
      )
        return false;
      setFront(first.front);
      setBack(first.back);
      setCardKind(first.kind);
      setClozeText(first.cloze?.text ?? "");
      setClozeIndex(String(first.cloze?.deletionIndex ?? 1));
      setCardObjectiveIds([...first.objectiveIds]);
      setCardEditorError(
        "Refinement applied to your draft. Save the card to keep this wording change.",
      );
      return true;
    }
    const cards = converted.right.map((content) => ({
      cardId: createAssessmentId(crypto.randomUUID()),
      content,
    }));
    const command: WorkspaceAuthoringCommand = editingCardId
      ? { kind: "replace-card", areaId: area.id, cardId: createAssessmentId(editingCardId), cards }
      : { kind: "create-cards", areaId: area.id, cards };
    const expectedBaseline = editingCardId ? cardEditor.current.baseline : undefined;
    cardSavePending.current = true;
    setCardSaving(true);
    setCardEditorError(null);
    const saved = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(command, expectedBaseline)),
    );
    cardSavePending.current = false;
    if (cardEditor.current.generation !== generation || !cardEditorMounted.current) return false;
    setCardSaving(false);
    if (Either.isLeft(saved)) {
      setCardEditorError(saved.left.message);
      return false;
    }
    closeCardEditor();
    setShowAnswer(false);
    return true;
  }

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!area || cardSavePending.current) return;
    if (!duplicatesAccepted) {
      setCardEditorError("Review the matching cards and choose Keep both before saving.");
      return;
    }
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
        const latestCandidates = workspaceDuplicateCandidates(current);
        if (
          findCardDuplicates(
            duplicateDraft,
            latestCandidates,
            editingCardId ? { excludeCardId: editingCardId } : {},
          ).length > 0 &&
          duplicateAcknowledgement !==
            cardDuplicateAcknowledgementKey(
              duplicateDraft,
              latestCandidates,
              editingCardId ?? undefined,
            )
        ) {
          reject("The matching cards changed. Review them and choose Keep both before saving.");
          return false;
        }
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
                : "This card could not be kept in the current tab. Your draft is preserved; reconnect and retry.",
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

  function editCard(target: Assessment) {
    if (cardSavePending.current) return;
    setDuplicateAcknowledgement(null);
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
    setDuplicateAcknowledgement(null);
  }

  function addCard() {
    if (cardSavePending.current) return;
    if (!area) {
      addArea();
      return;
    }
    closeCardEditor();
    setAddingCard(true);
  }

  async function deleteCard(target: Assessment) {
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
    requestConfirmation(
      `Delete this study card from “${latestArea.title}”?\n\n${latestCard.front}\n\nIts review history will remain.`,
      () => commitDeletion({ command, baseline, label: latestCard.front, error: "", stale: false }),
    );
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
    toast.success(`${area.title} exported as ${extension.toUpperCase()}.`);
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
    if (Either.isLeft(exported))
      toast.error(
        "This tab's snapshot could not be downloaded. Try exporting again before reloading.",
      );
    else
      toast.success(
        "This tab's private JSON snapshot was exported with reviews and schedules. Attachment bytes are included only in ZIP backups.",
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
        toast.success(
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
        toast.message("Backup export was canceled.");
      } else {
        toast.error("The private backup could not be saved.");
      }
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
    const link = window.document.createElement("a");
    link.href = objectUrl;
    link.download = "recall-workspace-backup.zip";
    link.click();
    URL.revokeObjectURL(objectUrl);
    toast.success("Private backup exported with review history, schedules, and attached media.");
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
      const prepared = prepareWorkspaceForSync(imported.right.workspace, () => crypto.randomUUID());
      requestConfirmation(
        "Replace this tab’s current workspace with the selected backup?",
        () =>
          commitContentImport({
            replacement: prepared,
            expectedWorkspace: workspaceRef.current,
            media: imported.right.media,
            message: "Private backup restored with review history, schedules, and media.",
          }),
        () => failContentImport("Backup restore cancelled. Your workspace is unchanged."),
      );
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
    const prepared = prepareWorkspaceForSync(restoredResult.right, () => crypto.randomUUID());
    requestConfirmation("Replace this tab’s current workspace with the selected backup?", () => {
      if (!beginContentImport()) return;
      return commitContentImport({
        replacement: prepared,
        expectedWorkspace: workspaceRef.current,
        message: "Backup loaded into this tab. Syncing it to your account…",
      });
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

  return (
    <>
      <AlertDialog
        open={pendingConfirmation !== null && workspaceUnlocked}
        onOpenChange={(open) => {
          if (!open && pendingConfirmation) {
            const confirmation = pendingConfirmation;
            setPendingConfirmation(null);
            confirmation.onCancel?.();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {pendingConfirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                const confirmation = pendingConfirmation;
                setPendingConfirmation(null);
                if (confirmation) void confirmation.onConfirm();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SidebarProvider className="min-h-screen">
        <Sidebar>
          <SidebarHeader className="flex-col items-center gap-2.5 px-3.5 pt-3 pb-0">
            <SidebarTrigger className="group-data-[state=expanded]/sidebar:justify-start group-data-[state=expanded]/sidebar:px-[9px]">
              <span className="group-data-[state=collapsed]/sidebar:hidden flex items-center gap-2.5">
                <span className="inline-flex size-[27px] items-center justify-center rounded-[9px] bg-[var(--green)] font-serif text-[19px] font-bold text-[var(--paper)]">
                  r
                </span>
                <span className="text-[21px] font-bold tracking-[-1px] text-[var(--ink)]">
                  recall<span className="text-[var(--status-success-fg)]">.</span>
                </span>
              </span>
            </SidebarTrigger>
          </SidebarHeader>
          <SidebarContent className="gap-0 pt-1">
            <SidebarGroup>
              <SidebarGroupLabel className="mx-1">
                <span className="group-data-[state=collapsed]/sidebar:invisible">
                  YOUR WORKSPACE
                </span>
                <button
                  type="button"
                  className="ml-auto grid size-[26px] shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                  aria-label="Search"
                  title="Search"
                  disabled={
                    !workspaceUnlocked ||
                    reviewSaving ||
                    reviewSaveFailed ||
                    addingCard ||
                    addingArea
                  }
                  onClick={() => setSearchOpen(true)}
                >
                  <Search aria-hidden="true" className="size-4" />
                </button>
              </SidebarGroupLabel>
              <SidebarMenu aria-label="Main navigation">
                {dashboardNavigationItems.map(({ view, label }) => {
                  const Icon = {
                    [DashboardView.Today]: CalendarDays,
                    [DashboardView.Library]: BookOpen,
                    [DashboardView.Tutor]: Sparkles,
                    [DashboardView.Insights]: ChartNoAxesCombined,
                  }[view];
                  return (
                    <SidebarMenuItem key={view}>
                      <SidebarMenuButton
                        isActive={activeView === view}
                        tooltip={label}
                        onClick={() => setActiveView(view)}
                      >
                        <Icon aria-hidden="true" />
                        <span className="group-data-[state=collapsed]/sidebar:hidden overflow-hidden text-ellipsis whitespace-nowrap">
                          {label}
                        </span>
                        {view === DashboardView.Today && workspaceUnlocked && (
                          <SidebarMenuBadge className="group-data-[state=collapsed]/sidebar:hidden">
                            {dueCount}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
            {workspaceUnlocked && (
              <SidebarGroup className="mt-0">
                <SidebarGroupLabel>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap group-data-[state=collapsed]/sidebar:invisible">
                    YOUR LEARNING AREAS
                  </span>
                  <SidebarGroupAction
                    className="static ml-auto grid size-[26px] shrink-0 translate-y-0 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] group-data-[state=collapsed]/sidebar:invisible [&_svg]:size-[15px]"
                    type="button"
                    aria-label="Add learning area"
                    onClick={addArea}
                  >
                    <Plus aria-hidden="true" />
                  </SidebarGroupAction>
                </SidebarGroupLabel>
                <SidebarMenu>
                  {workspace.areas.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={selectedId === item.id && activeView === DashboardView.Today}
                        tooltip={item.title}
                        disabled={reviewSaving || reviewSaveFailed}
                        onClick={() => {
                          setSelectedId(item.id);
                          setShowAnswer(false);
                          setActiveView(DashboardView.Today);
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none tabular-nums text-white"
                          style={{ backgroundColor: item.color }}
                        >
                          {item.cards.filter((entry) => dueNow(entry, now)).length}
                        </span>
                        <span className="group-data-[state=collapsed]/sidebar:hidden overflow-hidden text-ellipsis whitespace-nowrap">
                          {item.title}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter>
            {(workspaceUnlocked || accountStatus === "signed-in") && (
              <div hidden={!workspaceUnlocked}>
                <WorkspaceSyncAction
                  autoSync={!demo}
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
                              return Either.left({
                                _tag: "WorkspaceSyncCheckpointFailure",
                              } as const);
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
                              return Either.left({
                                _tag: "WorkspaceSyncCheckpointFailure",
                              } as const);
                            const persisted = await Effect.runPromise(
                              Effect.either(saveWorkspace(browserWorkspaceStore, bound.right)),
                            );
                            if (Either.isLeft(persisted))
                              return Either.left({
                                _tag: "WorkspaceSyncCheckpointFailure",
                              } as const);
                            if (localWritesBlocked())
                              return Either.left({
                                _tag: "WorkspaceSyncCheckpointFailure",
                              } as const);
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
                        "Synced changes could not be reconciled. Your latest tab workspace was preserved.",
                      );
                      return null;
                    }
                    setCloudWorkspaceLoaded(true);
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
              </div>
            )}
            {(erased || stale || reviewSaving || reviewSaveFailed) && (
              <div role="status">
                <i />{" "}
                {erased || stale
                  ? "Read-only in this tab"
                  : reviewSaving
                    ? "Saving review…"
                    : "Review save needs retry"}
              </div>
            )}
            <SidebarMenu>
              <SidebarMenuItem>
                <Popover open={accountPanelOpen} onOpenChange={setAccountPanelOpen}>
                  <PopoverTrigger asChild>
                    <SidebarMenuButton
                      keepMobileOpen
                      tooltip="Account"
                      isActive={accountPanelOpen}
                      aria-expanded={accountPanelOpen}
                    >
                      <UserRound aria-hidden="true" />
                      <span className="group-data-[state=collapsed]/sidebar:hidden flex min-w-0 flex-1 flex-col gap-0.5">
                        <strong>Account</strong>
                      </span>
                      <ChevronDown
                        className="group-data-[state=collapsed]/sidebar:hidden ml-auto text-[var(--muted)]"
                        aria-hidden="true"
                      />
                    </SidebarMenuButton>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="end"
                    className="max-h-[min(80svh,40rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto p-3 [&_[data-slot=account-action]]:items-stretch [&_[data-slot=account-action]]:flex-col [&_[data-slot=account-action]]:gap-2"
                  >
                    <button
                      type="button"
                      className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => setDeviceSettings(true)}
                    >
                      <Settings2 aria-hidden="true" className="size-4" />
                      Device settings
                    </button>
                    <AccountAction
                      demo={Boolean(demo)}
                      {...(workspaceUnlocked ? { workspace } : {})}
                    />
                  </PopoverContent>
                </Popover>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-w-0" id="today">
          <div className="flex items-center gap-3 border-b px-4 py-2 md:hidden">
            <SidebarTrigger
              className="size-9 w-9"
              aria-label="Open navigation"
              title="Open navigation"
            />
            <a className="font-semibold text-foreground no-underline" href="#today">
              Recall
            </a>
          </div>
          {!workspaceUnlocked ? (
            <main className="mx-auto grid min-h-[60vh] w-full max-w-2xl content-center gap-4 px-4 py-12 sm:px-8">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {accountStatus === "checking"
                    ? "Checking your account…"
                    : accountStatus === "unavailable"
                      ? "Sign in to access your cards"
                      : !webAccountConfigured
                        ? "Sign in to access your cards"
                        : accountStatus === "signed-in"
                          ? "Loading your account workspace…"
                          : "Sign in to access your cards"}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {accountStatus === "signed-in"
                    ? "Your cards will appear here when the account workspace has loaded."
                    : "Card creation, reading, and study require a signed-in account."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {accountStatus === "signed-out" && webAccountConfigured && (
                    <Button asChild>
                      <a href="/sign-in">Sign in</a>
                    </Button>
                  )}
                  {accountStatus === "unavailable" && <Button onClick={checkAccount}>Retry</Button>}
                </div>
              </div>
            </main>
          ) : (
            <>
              {stale && !erased && (
                <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
                  Another tab saved a newer workspace. This tab is read-only; your unsaved changes
                  are still here. Export them before reloading the latest saved workspace.
                  <Button onClick={() => void exportWorkspaceBackup()}>
                    Export this tab backup
                  </Button>
                  <Button onClick={() => exportWorkspaceSnapshot()}>Export JSON snapshot</Button>
                  <Button
                    onClick={() => {
                      if (!demo) window.location.reload();
                    }}
                  >
                    Reload latest saved workspace
                  </Button>
                </Alert>
              )}
              {(contentImportBusy || pendingContentImport) && (
                <Alert
                  className="my-3 flex flex-wrap items-center gap-2"
                  role={contentImportBusy ? "status" : "alert"}
                >
                  {contentImportBusy
                    ? "Saving imported content…"
                    : "This import has not been confirmed saved. Its content is retained on this page."}
                  {!contentImportBusy && pendingContentImport && (
                    <>
                      <Button
                        onClick={() => {
                          const retry = () =>
                            void commitContentImport({
                              ...pendingContentImport,
                              expectedWorkspace: workspaceRef.current,
                            });
                          if (pendingContentImport.replacement)
                            requestConfirmation(
                              "Replace the current workspace with this backup? Changes made since the earlier attempt will be replaced.",
                              retry,
                            );
                          else retry();
                        }}
                      >
                        Retry saving import
                      </Button>
                      <Button
                        onClick={() => {
                          setPendingContentImport(null);
                          setImportNotice(
                            "Import cancelled. Your current workspace remains available.",
                          );
                        }}
                      >
                        Cancel import
                      </Button>
                    </>
                  )}
                </Alert>
              )}
              {(importNotice || erased) && (
                <Alert className="my-3 flex flex-wrap items-center gap-2" role="status">
                  {erased
                    ? "This tab is read-only while its working copy is being cleared. Retry if cleanup fails."
                    : importNotice}
                  {cacheBlocked && !stale && (
                    <Button onClick={() => void discardSavedWorkspace()}>Clear saved data</Button>
                  )}
                  <Button aria-label="Dismiss notice" onClick={() => setImportNotice(null)}>
                    ×
                  </Button>
                </Alert>
              )}
              {reviewSaveFailed && (
                <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
                  This review has not been confirmed saved. The answer is still here; retry saving
                  the same review before continuing. Other saves are paused so a pending review
                  cannot be overwritten.
                  <Button
                    disabled={erased || stale}
                    onClick={() => {
                      const rating = pendingReviewRef.current?.rating ?? "good";
                      void review(rating);
                    }}
                  >
                    Retry review save
                  </Button>
                  <Button onClick={exportWorkspaceSnapshot}>Export this tab snapshot</Button>
                  <Button onClick={() => void exportWorkspaceBackup()}>
                    Export saved attachments backup
                  </Button>
                </Alert>
              )}

              {(libraryMutation === "area-delete" || libraryMutation === "card-delete") && (
                <Alert className="my-3 flex flex-wrap items-center gap-2" role="status">
                  Saving deletion on this device… The content remains available until saving
                  completes.
                </Alert>
              )}
              {deletionRequest && libraryMutation === null && (
                <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
                  <span>{deletionRequest.error}</span>
                  <Button onClick={() => void retryDeletion()}>
                    {deletionRequest.stale
                      ? "Review and confirm latest deletion"
                      : "Retry saved deletion request"}
                  </Button>
                  <Button onClick={() => setDeletionRequest(null)}>Cancel deletion request</Button>
                </Alert>
              )}

              <div
                className="mx-auto w-full max-w-[1080px] px-4 py-10 sm:px-8 lg:px-11"
                hidden={activeView !== DashboardView.Tutor}
                inert={reviewSaving || reviewSaveFailed}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Tutor</h1>
                    <p className="m-0 text-[12px] text-[var(--ink)]">
                      Ask questions about your learning area
                    </p>
                  </div>
                  {workspace.areas.length > 0 && (
                    <label className="grid gap-1.5 text-[12px] text-[var(--ink)]">
                      Study area
                      <StudyAreaSelect
                        areas={workspace.areas}
                        value={selectedId ?? ""}
                        disabled={reviewSaving || reviewSaveFailed}
                        ariaLabel="Area"
                        onValueChange={setSelectedId}
                      />
                    </label>
                  )}
                </div>
                <div className="mt-7">
                  {!demo && area && tutorAreaDocument && Either.isRight(tutorAreaDocument) && (
                    <TutorPanel
                      key={area.id}
                      knowledgeArea={tutorAreaDocument.right}
                      duplicateCandidates={duplicateCandidates}
                      {...(searchTarget?.areaId === area.id
                        ? { searchTarget: searchTarget.target }
                        : {})}
                      reviewEvents={workspace.reviewEvents ?? []}
                      onStartReview={() => setActiveView(DashboardView.Today)}
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
                            setImportNotice("Card saved.");
                            return saved.right.proposal;
                          }
                        });
                      }}
                    />
                  )}
                  {!demo && area && tutorAreaDocument && Either.isLeft(tutorAreaDocument) && (
                    <p className="mt-2.5 text-[11px] text-[var(--status-warning-fg)]" role="status">
                      The AI tutor is unavailable because this learning area has invalid content.
                    </p>
                  )}

                  {!area && <p>Add an area in Library to begin.</p>}
                </div>
              </div>
              {activeView === DashboardView.Tutor ? null : activeView === DashboardView.Today ? (
                <>
                  {!practiceId ? (
                    <main className="mx-auto min-h-[80vh] w-full max-w-[1080px] px-4 py-10 sm:px-8 lg:px-11">
                      <div className="mb-7">
                        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
                        <p className="m-0 text-sm text-[var(--muted)]">
                          {dueCount} cards to review across {workspace.areas.length} learning areas
                          · {studiedToday} reviewed today
                        </p>
                      </div>
                      {workspace.areas.length === 0 ? (
                        <p className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
                          No learning areas yet. Add an area in Library to begin.
                        </p>
                      ) : (
                        <div className="grid gap-3">
                          {workspace.areas.map((item) => {
                            const due = item.cards.filter((entry) => dueNow(entry, now)).length;
                            return (
                              <section
                                key={item.id}
                                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span
                                    className="size-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0">
                                    <h2 className="m-0 truncate text-lg font-semibold">
                                      {item.title}
                                    </h2>
                                    <p className="m-0 text-sm text-[var(--muted)]">
                                      {due > 0
                                        ? `${due} ${due === 1 ? "card" : "cards"} to review`
                                        : "Nothing due right now"}{" "}
                                      · {item.cards.length} total
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant={due > 0 ? "default" : "secondary"}
                                  disabled={due === 0}
                                  onClick={() => onPracticeChange?.(item.id)}
                                >
                                  {due > 0 ? "Start practice" : "All caught up"}
                                </Button>
                              </section>
                            );
                          })}
                        </div>
                      )}
                    </main>
                  ) : (
                    <div
                      className="mx-auto w-full max-w-[1080px] px-4 py-10 sm:px-8 lg:px-11"
                      inert={reviewSaving || reviewSaveFailed}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div>
                            <h1 className="text-3xl font-semibold tracking-tight">
                              {area?.title ?? "Practice"}
                            </h1>
                            <button
                              type="button"
                              className="mt-1 text-sm text-[var(--muted)] underline-offset-4 hover:underline"
                              onClick={() => onViewChange?.(DashboardView.Today)}
                            >
                              Back to Today
                            </button>
                          </div>
                          <p className="m-0 text-[12px] text-[var(--ink)]">
                            {area?.cards.filter((entry) => dueNow(entry, now)).length ?? 0} due ·{" "}
                            {studiedToday} reviewed today
                          </p>
                        </div>
                        <label className="grid gap-1.5 text-[12px] text-[var(--ink)]">
                          Study area
                          <StudyAreaSelect
                            areas={workspace.areas}
                            value={selectedId ?? ""}
                            disabled={reviewSaving || reviewSaveFailed}
                            onValueChange={(value) => {
                              setSelectedId(value);
                              setShowAnswer(false);
                              onPracticeChange?.(value);
                            }}
                            renderDetail={(item) => (
                              <span className="shrink-0 text-muted-foreground">
                                · {item.cards.filter((entry) => dueNow(entry, now)).length} due
                              </span>
                            )}
                          />
                        </label>
                      </div>
                      <div className="mt-7 block">
                        {!area ? (
                          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
                            This learning area is no longer available.{" "}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => onViewChange?.(DashboardView.Today)}
                            >
                              Return to Today
                            </button>
                          </p>
                        ) : (
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
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="mx-auto min-h-[80vh] w-full max-w-[1080px] px-4 py-10 sm:px-8 lg:px-11"
                  inert={reviewSaving || reviewSaveFailed}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h1 className="text-3xl font-semibold tracking-tight">
                      {activeView === DashboardView.Library ? "Library" : "Insights"}
                    </h1>
                    {activeView === DashboardView.Library && (
                      <Button variant="secondary" onClick={() => setImportExportOpen(true)}>
                        Import and export
                      </Button>
                    )}
                    {activeView === DashboardView.Insights && (
                      <Button variant="secondary" onClick={() => setReviewSettingsOpen(true)}>
                        Review settings
                      </Button>
                    )}
                  </div>
                  {activeView === DashboardView.Library ? (
                    <>
                      <div className="mt-7 grid gap-7">
                        <section
                          aria-label="Learning areas"
                          className="flex min-w-0 items-center gap-2"
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <ShadcnButton
                                type="button"
                                variant="outline"
                                className="min-w-0 flex-1 justify-between gap-2"
                              >
                                {area && (
                                  <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: area.color }}
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="min-w-0 flex-1 truncate text-left">
                                  {area?.title ?? "Select a learning area"}
                                </span>
                                {area && (
                                  <span className="shrink-0 text-xs text-[var(--muted)]">
                                    {area.cards.filter((card) => dueNow(card, now)).length} due
                                  </span>
                                )}
                                <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                              </ShadcnButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-64">
                              <DropdownMenuItem disabled={!area} onSelect={addCard}>
                                <Plus aria-hidden="true" />
                                Add a card
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {workspace.areas.map((item) => (
                                <DropdownMenuItem
                                  key={item.id}
                                  onSelect={() => {
                                    setSelectedId(item.id);
                                    setShowAnswer(false);
                                  }}
                                >
                                  <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                    aria-hidden="true"
                                  />
                                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                                    {item.cards.filter((card) => dueNow(card, now)).length} due
                                  </span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <ShadcnButton
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="size-9 shrink-0"
                            aria-label="New area"
                            onClick={addArea}
                          >
                            <Plus aria-hidden="true" />
                          </ShadcnButton>
                          {area && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <ShadcnButton
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  className="size-9 shrink-0"
                                  aria-label={`Actions for ${area.title}`}
                                >
                                  <Ellipsis aria-hidden="true" />
                                </ShadcnButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setShareKnowledgeOpen(true);
                                  }}
                                >
                                  Share knowledge
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => editArea(area)}>
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setShowAreaSettings(true)}>
                                  Settings
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => void deleteArea(area)}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </section>
                        <div className="min-w-0 pt-1">
                          {area && (
                            <>
                              <Dialog
                                open={showAreaSettings && workspaceUnlocked}
                                onOpenChange={setShowAreaSettings}
                              >
                                <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-3xl">
                                  <DialogHeader>
                                    <DialogTitle>Area settings</DialogTitle>
                                    <DialogDescription>Update {area.title}.</DialogDescription>
                                  </DialogHeader>
                                  <KnowledgeAreaSettings
                                    key={`area-settings-${area.id}`}
                                    area={area}
                                    readLatest={() =>
                                      workspaceRef.current.areas.find(
                                        (item) => item.id === area.id,
                                      ) ?? null
                                    }
                                    onSave={(settings, expectedBaseline) =>
                                      saveAuthoringCommand(
                                        { kind: "update-area-settings", areaId: area.id, settings },
                                        expectedBaseline,
                                      ).pipe(
                                        Effect.flatMap((saved) => {
                                          const updated = saved.areas.find(
                                            (item) => item.id === area.id,
                                          );
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
                                </DialogContent>
                              </Dialog>
                              <KnowledgeAreaCardLibrary
                                key={`area-library-${area.id}`}
                                area={area}
                                onEdit={editCard}
                                onDelete={(target) => void deleteCard(target)}
                                onAdd={addCard}
                                workspace={workspace}
                                showDeletedRecovery={false}
                                onRestoreVersion={restoreVersion}
                                restoring={
                                  cardSaving ||
                                  libraryMutation !== null ||
                                  reviewSaving ||
                                  reviewSaveFailed
                                }
                                onOpenDuplicate={(candidate) => {
                                  const existing = workspaceRef.current.areas
                                    .flatMap((item) => item.cards)
                                    .find((item) => item.id === candidate.id);
                                  if (existing) editCard(existing);
                                }}
                              />
                            </>
                          )}
                          <DeletedCardRecovery
                            workspace={workspace}
                            onRestoreVersion={restoreVersion}
                            disabled={
                              cardSaving ||
                              libraryMutation !== null ||
                              reviewSaving ||
                              reviewSaveFailed
                            }
                          />
                          <Dialog
                            open={importExportOpen && workspaceUnlocked}
                            onOpenChange={setImportExportOpen}
                          >
                            <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Import and export</DialogTitle>
                                <DialogDescription>
                                  Import cards or restore a workspace backup. Export cards or save a
                                  backup.
                                </DialogDescription>
                              </DialogHeader>
                              <div
                                className="flex flex-wrap gap-2"
                                aria-label="Import and export tools"
                              >
                                <AnkiImportAction
                                  color={
                                    colors[workspace.areas.length % colors.length] ?? "#c4ed68"
                                  }
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
                                      catch: () =>
                                        ({ _tag: "AnkiImportAcceptanceUnavailable" }) as const,
                                    }).pipe(
                                      Effect.flatMap((saved) =>
                                        saved
                                          ? Effect.void
                                          : Effect.fail({ _tag: "AnkiImportNotSaved" } as const),
                                      ),
                                    )
                                  }
                                />
                                <label
                                  className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline"
                                  htmlFor="delimited-import"
                                >
                                  Import CSV/TSV
                                </label>
                                <input
                                  id="delimited-import"
                                  className="sr-only"
                                  type="file"
                                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                                  onChange={importDelimited}
                                />
                                <Button
                                  variant="secondary"
                                  className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                                  onClick={() => exportDelimited(",")}
                                  disabled={!area}
                                >
                                  Export CSV
                                </Button>
                                <Button
                                  variant="secondary"
                                  className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                                  onClick={() => exportDelimited("\t")}
                                  disabled={!area}
                                >
                                  Export TSV
                                </Button>
                                <Button
                                  variant="secondary"
                                  className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                                  onClick={exportWorkspaceBackup}
                                >
                                  Backup workspace
                                </Button>
                                <label
                                  className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline"
                                  htmlFor={
                                    isDesktopRuntime() ? undefined : "workspace-backup-import"
                                  }
                                  onClick={
                                    isDesktopRuntime() ? restoreDesktopWorkspaceBackup : undefined
                                  }
                                >
                                  Restore backup
                                </label>
                                <input
                                  id="workspace-backup-import"
                                  className="sr-only"
                                  type="file"
                                  accept="application/zip,.zip,application/json,.json"
                                  onChange={restoreWorkspaceBackup}
                                />
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Dialog
                            open={shareKnowledgeOpen && workspaceUnlocked}
                            onOpenChange={setShareKnowledgeOpen}
                          >
                            <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-3xl">
                              <DialogHeader>
                                <DialogTitle id="publication-title">Share knowledge</DialogTitle>
                                <DialogDescription>
                                  Publish a learning area or receive one from a shared link.
                                </DialogDescription>
                              </DialogHeader>
                              <KnowledgeAreaPublishing
                                key={area?.id ?? "receive-shared-area"}
                                embedded
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
                                  if ((!cacheWritable || !ready || localWritesBlocked()) && !demo)
                                    return false;
                                  return enqueueWorkspaceSave(async () => {
                                    for (;;) {
                                      if (
                                        localWritesBlocked() ||
                                        localSnapshotStale() ||
                                        pendingReviewRef.current
                                      )
                                        return false;
                                      const current = workspaceRef.current;
                                      const existing = current.areas.find(
                                        (item) => item.id === document.id,
                                      );
                                      if (existing) {
                                        if (existing.forkedFromVersionId !== forkedFromVersionId)
                                          return false;
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
                                                assets.filter((asset) =>
                                                  requiredMedia.has(asset.reference.id),
                                                ),
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
                                        setActiveView(DashboardView.Today);
                                        return true;
                                      }
                                      const imported = Effect.runSync(
                                        Effect.either(
                                          fromKnowledgeArea(
                                            {
                                              ...document,
                                              licence: license,
                                              attribution,
                                              forkedFromVersionId,
                                            },
                                            colors[current.areas.length % colors.length] ??
                                              "#c4ed68",
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
                                      setActiveView(DashboardView.Today);
                                      setImportNotice(
                                        `${imported.right.title} added as your copy. Attribution and license are preserved.`,
                                      );
                                      return true;
                                    }
                                  });
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-[30px] grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:grid-cols-2">
                        <div className="flex items-baseline gap-3 sm:col-span-2">
                          <strong className="text-3xl font-semibold">{totalReviews}</strong>
                          <span className="text-sm text-[var(--muted)]">
                            reviews completed all time
                          </span>
                        </div>
                        <p className="m-0 text-sm text-[var(--muted)]">
                          {dueCount} cards are ready across {workspace.areas.length} learning areas.
                        </p>
                        <p className="m-0 text-sm text-[var(--muted)]">
                          {studiedToday} today · {practice.week.inWindow} in the last 7 calendar
                          days
                        </p>
                        <p className="m-0 text-sm text-[var(--muted)] sm:col-span-2">
                          Last 7 days: {practice.week.ratings.again} Again ·{" "}
                          {practice.week.ratings.hard} Hard · {practice.week.ratings.good} Good ·{" "}
                          {practice.week.ratings.easy} Easy
                        </p>
                      </div>
                      {(retainedCards > 0 ||
                        missingDeletedReviewContent ||
                        deletedReviewProvisionCapacity) && (
                        <section
                          className="mt-6 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6"
                          aria-labelledby="deleted-review-sync-title"
                        >
                          <h2 className="text-xl font-semibold" id="deleted-review-sync-title">
                            Deleted content awaiting sync
                          </h2>
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
                                These cards stay out of your library and study queue. Sync preserves
                                their reviews before confirming the deletions, then releases the
                                retained content.
                              </p>
                            </>
                          )}
                          {missingDeletedReviewContent && (
                            <Alert variant="destructive">
                              This older workspace has a pending review whose deleted card is
                              missing. Export this device&apos;s current private backup or review
                              snapshot before replacing it with an older backup containing that
                              card. Backups are not automatically merged; your review history
                              remains saved.
                            </Alert>
                          )}
                          {deletedReviewProvisionCapacity && (
                            <Alert variant="destructive">
                              Cloud content and pending deleted-review content exceed this
                              area&apos;s card or objective limits. Local cards and reviews remain
                              saved. Export a private backup before changing cloud content to free
                              capacity.
                            </Alert>
                          )}
                          <Button
                            variant="secondary"
                            className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                            onClick={exportWorkspaceSnapshot}
                          >
                            Export private recovery snapshot
                          </Button>
                          {missingDeletedReviewContent && (
                            <Button
                              variant="secondary"
                              className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                              onClick={() => setActiveView(DashboardView.Library)}
                            >
                              Open backup restore tools
                            </Button>
                          )}
                          {deletedReviewProvisionCapacity && (
                            <>
                              <Button
                                variant="secondary"
                                className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                                onClick={() => void exportWorkspaceBackup()}
                              >
                                Export private backup
                              </Button>
                              <Button
                                variant="secondary"
                                className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                                onClick={() => setActiveView(DashboardView.Library)}
                              >
                                Open area library
                              </Button>
                            </>
                          )}
                        </section>
                      )}
                      <section
                        className="mt-8 max-w-[850px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
                        aria-labelledby="review-history-title"
                      >
                        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
                          <div>
                            <h2 className="text-lg font-semibold" id="review-history-title">
                              Recent reviews
                            </h2>
                          </div>
                          <span className="text-sm text-[var(--muted)]">
                            {workspace.reviewEvents?.length ?? 0} total
                          </span>
                        </div>
                        {reviewHistory.length ? (
                          <ol className="divide-y divide-[var(--line)]">
                            {reviewHistory.map((event) => (
                              <li
                                key={event.id}
                                className="grid gap-x-4 gap-y-1.5 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                              >
                                <span
                                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${event.rating === "again" ? "bg-[var(--surface-raised)] text-[var(--status-warning-fg)]" : "bg-[var(--surface-raised)] text-[var(--status-success-fg)]"}`}
                                >
                                  {event.rating}
                                </span>
                                <span className="min-w-0 truncate font-medium text-[var(--ink)]">
                                  {event.question}
                                </span>
                                <span className="min-w-0 text-sm text-[var(--muted)] sm:col-start-2">
                                  {event.areaTitle}
                                  {(event.hasConcurrentBranch ||
                                    event.needsSyncRetry ||
                                    event.retainedForSync) && (
                                    <span className="ml-2 text-[var(--status-warning-fg)]">
                                      {event.retainedForSync
                                        ? "Deleted · pending sync"
                                        : event.needsSyncRetry
                                          ? "Sync again"
                                          : "Pending sync"}
                                    </span>
                                  )}
                                </span>
                                <time
                                  className="text-sm text-[var(--muted)] sm:col-start-3 sm:row-span-2 sm:row-start-1"
                                  dateTime={event.ratedAt}
                                >
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
                            className="px-[22px] py-5 text-[var(--muted)]"
                            title="No reviews yet"
                            description="Your completed reviews will appear here."
                          />
                        )}
                      </section>
                    </>
                  )}
                  {activeView === DashboardView.Insights && (
                    <Dialog
                      open={reviewSettingsOpen && workspaceUnlocked}
                      onOpenChange={setReviewSettingsOpen}
                    >
                      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Review settings</DialogTitle>
                          <DialogDescription>
                            Adjust how reviews are scheduled for your workspace.
                          </DialogDescription>
                        </DialogHeader>
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
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              )}
            </>
          )}
        </SidebarInset>

        <Dialog open={searchOpen && workspaceUnlocked} onOpenChange={setSearchOpen}>
          <DialogContent className="gap-5 sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle id="workspace-search-title">Search</DialogTitle>
            </DialogHeader>
            <WorkspaceSearchPanel
              workspace={workspace}
              ownershipKey={workspace.syncOwnerId ?? "local"}
              onOpenResult={openSearchResult}
              {...(demo ? { demoNotebooks: [] } : {})}
            />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSearchOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={deviceSettings} onOpenChange={setDeviceSettings}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle id="device-settings-title">Device settings</DialogTitle>
            </DialogHeader>
            <DailyReminderSettingsPanel desktop={isDesktopRuntime()} />
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeviceSettings(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={addingArea && workspaceUnlocked}
          onOpenChange={(open) => {
            if (!open) closeAreaEditor();
          }}
        >
          <DialogContent
            className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto p-0"
            showCloseButton={false}
          >
            <form
              className="grid max-h-[calc(100dvh-2.5rem)] gap-3 overflow-y-auto rounded-xl bg-[var(--surface)] p-6"
              aria-busy={libraryMutation === "area-save"}
              onSubmit={createArea}
            >
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4 size-8 text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                disabled={libraryMutation === "area-save"}
                onClick={closeAreaEditor}
                aria-label="Close area editor"
              >
                ×
              </Button>
              <DialogHeader className="pr-10">
                <DialogTitle id="area-dialog-title">
                  {editingAreaId ? "Edit area" : "New area"}
                </DialogTitle>
              </DialogHeader>
              {areaEditorError && (
                <Alert variant="destructive">
                  <p>{areaEditorError}</p>
                  {areaDraftStale && editingAreaId && (
                    <Button
                      type="button"
                      className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                      disabled={libraryMutation !== null}
                      onClick={() => {
                        const latest = workspaceRef.current.areas.find(
                          (item) => item.id === editingAreaId,
                        );
                        if (latest)
                          requestConfirmation(
                            "Replace this draft with the latest saved area name and color? Copy any text you want to keep first.",
                            () => editArea(latest),
                          );
                      }}
                    >
                      Reopen latest saved area
                    </Button>
                  )}
                </Alert>
              )}
              <fieldset
                disabled={libraryMutation === "area-save"}
                className="grid gap-3"
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <label htmlFor="area-title">Area name</label>
                <Input
                  id="area-title"
                  autoFocus
                  value={areaTitle}
                  onChange={(event) => setAreaTitle(event.target.value)}
                  placeholder="e.g. Organic chemistry"
                  maxLength={80}
                />
                <p>Area color</p>
                <div className="flex items-center gap-2">
                  <RadioGroup
                    className="flex gap-2"
                    aria-label="Area color"
                    value={areaColor}
                    onValueChange={setAreaColor}
                  >
                    {colors.map((color) => (
                      <RadioGroupItem
                        key={color}
                        className={`size-8 rounded-full border border-[var(--line)] ${areaColor === color ? "ring-2 ring-[var(--primary)]" : ""}`}
                        aria-label={`Choose ${color} color`}
                        style={{ backgroundColor: color }}
                        value={color}
                      />
                    ))}
                  </RadioGroup>
                  <label className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]">
                    <Pipette aria-hidden="true" className="size-4" />
                    <input
                      type="color"
                      aria-label="Choose a custom area color"
                      title="Choose a custom area color"
                      value={areaColor}
                      onChange={(event) => setAreaColor(event.target.value)}
                      className="absolute inset-0 size-full cursor-pointer opacity-0"
                    />
                  </label>
                </div>
                <DialogFooter className="flex items-center justify-end gap-2">
                  <Button
                    size="small"
                    type="button"
                    onClick={() => {
                      setAddingArea(false);
                      setEditingAreaId(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    type="submit"
                    disabled={libraryMutation === "area-save" || !areaTitle.trim()}
                  >
                    {libraryMutation === "area-save"
                      ? "Saving area…"
                      : editingAreaId
                        ? "Save changes"
                        : "Create area"}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={addingCard && workspaceUnlocked}
          onOpenChange={(open) => {
            if (!open) closeCardEditor();
          }}
        >
          <DialogContent
            className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto"
            showCloseButton={false}
          >
            <form className="grid gap-3" onSubmit={createCard}>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4 size-8 text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                disabled={cardSaving}
                onClick={closeCardEditor}
                aria-label="Close card editor"
              >
                ×
              </Button>
              <DialogHeader className="pr-10">
                <DialogTitle id="card-dialog-title">
                  {editingCardId ? "Edit card" : "Add card"}
                </DialogTitle>
                <DialogDescription>{area?.title}</DialogDescription>
              </DialogHeader>
              {cardEditorError && (
                <Alert variant="destructive">
                  <p>{cardEditorError}</p>
                  {cardDraftStale && editingCardId && (
                    <Button
                      type="button"
                      className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                      disabled={cardSaving}
                      onClick={() => {
                        const latest = workspaceRef.current.areas
                          .flatMap((item) => item.cards)
                          .find((item) => item.id === editingCardId);
                        if (latest)
                          requestConfirmation(
                            "Replace this draft with the latest saved card? Copy any text you want to keep first.",
                            () => editCard(latest),
                          );
                      }}
                    >
                      Reopen latest saved card
                    </Button>
                  )}
                </Alert>
              )}
              <fieldset
                disabled={cardSaving}
                className="grid gap-3"
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <label htmlFor="card-kind">Card type</label>
                <Select
                  value={cardKind}
                  onValueChange={(value) => setCardKind(value === "cloze" ? "cloze" : "basic")}
                >
                  <SelectTrigger id="card-kind" aria-label="Card type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Question and answer</SelectItem>
                    <SelectItem value="cloze">Cloze · fill the gap</SelectItem>
                  </SelectContent>
                </Select>
                {cardKind === "basic" ? (
                  <>
                    <label htmlFor="card-front">Question</label>
                    <Textarea
                      id="card-front"
                      autoFocus
                      value={front}
                      onChange={(event) => setFront(event.target.value)}
                      placeholder="What do you want to remember?"
                      maxLength={500}
                      rows={3}
                    />
                    <label htmlFor="card-back">Answer</label>
                    <Textarea
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
                    <Textarea
                      id="card-cloze-text"
                      autoFocus
                      value={clozeText}
                      onChange={(event) => setClozeText(event.target.value)}
                      maxLength={10000}
                      rows={5}
                      placeholder="Mitochondria produce {{c1::ATP::energy molecule}}."
                    />
                    <p>
                      Wrap an answer like {"{{c1::ATP::energy molecule}}"}. Matching numbers hide
                      together; other numbers remain visible.
                    </p>
                    <label htmlFor="card-cloze-index">Deletion number to study</label>
                    <Input
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
                {tutorAreaDocument && Either.isRight(tutorAreaDocument) && (
                  <TutorPanel
                    knowledgeArea={tutorAreaDocument.right}
                    duplicateCandidates={duplicateCandidates}
                    onApprove={async () => null}
                    renderContent={(api) => (
                      <CardAssistancePanel
                        key={editingCardId ?? "new-card"}
                        proposal={{
                          front: cardKind === "cloze" ? clozeText : front,
                          back,
                          objectiveId: cardObjectiveIds[0] ?? null,
                          rationale: "Improve this library card.",
                        }}
                        knowledgeArea={tutorAreaDocument.right}
                        api={api}
                        existingCard={Boolean(editingCardId)}
                        duplicateCandidates={duplicateCandidates}
                        {...(editingCardId ? { excludeCardId: editingCardId } : {})}
                        onBusyChange={setCardSaving}
                        disabled={
                          cardSaving ||
                          Boolean(mediaFile) ||
                          cardDraftStale ||
                          (!demo && (!ready || !cacheWritable))
                        }
                        onApply={applyCardRefinement}
                      />
                    )}
                  />
                )}
                <CardDuplicateWarnings
                  draft={duplicateDraft}
                  candidates={duplicateCandidates}
                  {...(editingCardId ? { excludeCardId: editingCardId } : {})}
                  keepBoth={duplicateAcknowledgement === duplicateKey}
                  onKeepBothChange={(value) =>
                    setDuplicateAcknowledgement(value ? duplicateKey : null)
                  }
                  disabled={cardSaving}
                  onOpenCandidate={(candidate) => {
                    const existing = workspaceRef.current.areas
                      .flatMap((item) => item.cards)
                      .find((item) => item.id === candidate.id);
                    if (existing)
                      requestConfirmation("Discard this draft and open the existing card?", () =>
                        editCard(existing),
                      );
                  }}
                />
                <Accordion type="single" collapsible>
                  <AccordionItem value="card-details">
                    <AccordionTrigger>Card details</AccordionTrigger>
                    <AccordionContent>
                      {(area?.objectives?.length ?? 0) > 0 && (
                        <fieldset>
                          <legend>Learning objectives</legend>
                          {area?.objectives?.map((objective) => (
                            <label
                              key={objective.id}
                              style={{ display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Checkbox
                                checked={cardObjectiveIds.includes(objective.id)}
                                onCheckedChange={(checked) =>
                                  setCardObjectiveIds((current) =>
                                    checked === true
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
                      <Textarea
                        rows={2}
                        id="card-tags"
                        aria-describedby="card-tags-help"
                        value={cardTags}
                        onChange={(event) => setCardTags(event.target.value)}
                        placeholder="e.g. exam, fundamentals"
                      />
                      <small id="card-tags-help">Separate tags with commas.</small>
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
                            <Button
                              type="button"
                              className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                              onClick={() =>
                                setRemovedMediaIds((current) => [...current, reference.id])
                              }
                            >
                              Remove attachment
                            </Button>
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
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <DialogFooter className="flex items-center justify-end gap-2">
                  <Button size="small" type="button" onClick={closeCardEditor}>
                    Cancel
                  </Button>
                  <Button
                    size="small"
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
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarProvider>
    </>
  );
}
