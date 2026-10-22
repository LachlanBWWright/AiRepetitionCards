import { useEffect, useState } from "react";
import type { AssessmentSchedule, ReviewEvent } from "@recall/domain";
import { type ReviewRating } from "@recall/scheduler";
import { workspaceAuthoringBaseline, type WorkspaceAuthoringCommand } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import { InlineImage } from "@/components/ui/InlineImage";
import type { LearningArea, Assessment, Workspace } from "@/features/workspace/types";
import { fromKnowledgeArea, toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { Effect } from "effect";

export const dashboardColors = [
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
] as const;

export const starterWorkspace: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  reviewEvents: [],
  areas: [],
};

/** Create independent content identities for a fresh device. */
export function createFreshStarterWorkspace() {
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
    return { ...starterWorkspace, areas };
  });
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export function dueNow(card: Assessment, now: Date): boolean {
  return new Date(card.schedule.due).getTime() <= now.getTime();
}

export function MediaFilePreview({ file }: { readonly file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setUrl(reader.result);
    };
    reader.readAsDataURL(file);
    return () => {
      reader.abort();
    };
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

export type StoryDemo = {
  readonly workspace: Workspace;
  readonly view?: import("@/features/dashboard/navigation/dashboard-navigation").DashboardView;
  readonly selectedAreaId?: string;
  readonly editAreaId?: string;
  readonly areaDraft?: LearningArea;
  readonly areaEditFailure?: "stale-content" | "storage";
  readonly deletionFailure?: "area" | "card";
  readonly editCardId?: string;
  readonly cardDraft?: Assessment;
  readonly cardEditConflict?: boolean;
  readonly areaSettings?: boolean;
  readonly showAnswer?: boolean;
  readonly addCard?: boolean;
  readonly localErasureBlocked?: boolean;
  readonly localSnapshotStale?: boolean;
  readonly reviewSaveState?: "saving" | "failure";
  readonly missingReviewContent?: boolean;
  readonly syncAccountState?:
    "account-mismatch" | "owner-adoption-required" | "ownership-checkpoint";
  readonly mockMediaPreviews?: readonly { readonly mimeType: string; readonly url: string }[];
};

export const staleCardDraftMessage =
  "This card changed while you were editing. Your draft is preserved. Reopen the latest card before saving.";

export function cardEditingBaseline(workspace: Workspace, area: LearningArea, card: Assessment) {
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

export type DeletionCommand = Extract<
  WorkspaceAuthoringCommand,
  { readonly kind: "delete-area" | "delete-card" }
>;
export type DeletionRequest = {
  readonly command: DeletionCommand;
  readonly baseline: string;
  readonly label: string;
  readonly error: string;
  readonly stale: boolean;
};
export const staleAreaDraftMessage =
  "This area changed while you were editing. Your draft is preserved. Reopen the latest area before saving.";
export const areaSaveFailureMessage =
  "Save not confirmed. Your deck draft is still here. Check your connection, then retry saving.";

export function areaEditingBaseline(workspace: Workspace, area: LearningArea): string {
  return (
    workspaceAuthoringBaseline(
      { ...workspace, areas: workspace.areas.map((item) => (item.id === area.id ? area : item)) },
      { kind: "save-area", mode: "edit", id: area.id, title: area.title, color: area.color },
    ) ?? ""
  );
}

export type PendingReview = {
  readonly areaId: string;
  readonly cardId: string;
  readonly rating: ReviewRating;
  readonly eventId: string;
  readonly ratedAt: string;
  readonly elapsedMs?: number;
  readonly event?: ReviewEvent;
  readonly schedule?: AssessmentSchedule;
  readonly baseSchedule?: string;
  readonly baseEvents?: string;
};

export type PendingContentImport = {
  readonly area?: LearningArea;
  readonly media?: readonly StoredMediaAsset[];
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly replacement?: Workspace;
  readonly expectedWorkspace?: Workspace;
  readonly message: string;
};
