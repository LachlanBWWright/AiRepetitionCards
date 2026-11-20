import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import { RecallDashboardReviewHistory } from "@/features/dashboard/review/RecallDashboardReviewHistory";
import type { DashboardReviewHistoryEntry } from "@/features/dashboard/review/RecallDashboardReviewHistory";

type WeeklyPracticeSummary = {
  readonly inWindow: number;
  readonly ratings: {
    readonly again: number;
    readonly hard: number;
    readonly good: number;
    readonly easy: number;
  };
};

function retainedReviewDescription(cards: number, areas: number, reviews: number): string {
  const cardLabel = `${String(cards)} deleted card${cards === 1 ? "" : "s"}`;
  const areaLabel = areas > 0 ? ` in ${String(areas)} deleted deck${areas === 1 ? "" : "s"}` : "";
  const reviewLabel =
    reviews > 0
      ? `retained privately for ${String(reviews)} pending review${reviews === 1 ? "" : "s"}.`
      : "retained privately until deletion acknowledgements arrive.";
  return `${cardLabel}${areaLabel} ${reviewLabel}`;
}

function DeletedContentNotice({
  retainedCards,
  deletedRetainedAreas,
  retainedPendingReviews,
  missingDeletedReviewContent,
  deletedReviewProvisionCapacity,
  onExportSnapshot,
  onExportBackup,
  onOpenLibrary,
}: {
  readonly retainedCards: number;
  readonly deletedRetainedAreas: number;
  readonly retainedPendingReviews: number;
  readonly missingDeletedReviewContent: boolean;
  readonly deletedReviewProvisionCapacity: boolean;
  readonly onExportSnapshot: () => void;
  readonly onExportBackup: () => void;
  readonly onOpenLibrary: () => void;
}) {
  if (!(retainedCards > 0 || missingDeletedReviewContent || deletedReviewProvisionCapacity))
    return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6"
      aria-labelledby="deleted-review-sync-title"
    >
      <h2 className="text-xl font-semibold" id="deleted-review-sync-title">
        Deleted content awaiting sync
      </h2>
      {retainedCards > 0 && (
        <>
          <p>
            {retainedReviewDescription(retainedCards, deletedRetainedAreas, retainedPendingReviews)}
          </p>
          <p>
            These cards stay out of your library and study queue. Sync preserves their reviews
            before confirming the deletions, then releases the retained content.
          </p>
        </>
      )}
      {missingDeletedReviewContent && (
        <Alert variant="destructive">
          This older workspace has a pending review whose deleted card is missing. Export this
          device&apos;s current private backup or review snapshot before replacing it with an older
          backup containing that card. Backups are not automatically merged; your review history
          remains saved.
        </Alert>
      )}
      {deletedReviewProvisionCapacity && (
        <Alert variant="destructive">
          Cloud content and pending deleted-review content exceed this area&apos;s card or objective
          limits. Local cards and reviews remain saved. Export a private backup before changing
          cloud content to free capacity.
        </Alert>
      )}
      <Button variant="default" onClick={onExportSnapshot}>
        Export private recovery snapshot
      </Button>
      {missingDeletedReviewContent && (
        <Button variant="default" onClick={onOpenLibrary}>
          Open backup restore tools
        </Button>
      )}
      {deletedReviewProvisionCapacity && (
        <>
          <Button variant="default" onClick={onExportBackup}>
            Export private backup
          </Button>
          <Button variant="default" onClick={onOpenLibrary}>
            Open area library
          </Button>
        </>
      )}
    </section>
  );
}

export function RecallDashboardInsightsSummary({
  totalReviews,
  dueCount,
  areaCount,
  studiedToday,
  week,
  retainedCards,
  deletedRetainedAreas,
  retainedPendingReviews,
  missingDeletedReviewContent,
  deletedReviewProvisionCapacity,
  onExportSnapshot,
  onExportBackup,
  onOpenLibrary,
  reviewHistory,
  totalReviewEvents,
}: {
  readonly totalReviews: number;
  readonly dueCount: number;
  readonly areaCount: number;
  readonly studiedToday: number;
  readonly week: WeeklyPracticeSummary;
  readonly retainedCards: number;
  readonly deletedRetainedAreas: number;
  readonly retainedPendingReviews: number;
  readonly missingDeletedReviewContent: boolean;
  readonly deletedReviewProvisionCapacity: boolean;
  readonly onExportSnapshot: () => void;
  readonly onExportBackup: () => void;
  readonly onOpenLibrary: () => void;
  readonly reviewHistory: readonly DashboardReviewHistoryEntry[];
  readonly totalReviewEvents: number;
}) {
  return (
    <section
      className="flex w-full min-w-0 max-w-4xl flex-col gap-6"
      aria-label="Workspace review summary"
    >
      <p className="text-sm text-[var(--muted)]">
        Workspace totals: {totalReviews} reviews all time · {studiedToday} today · {week.inWindow}{" "}
        in the last 7 days. {dueCount} cards ready across {areaCount} decks.
      </p>
      <DeletedContentNotice
        retainedCards={retainedCards}
        deletedRetainedAreas={deletedRetainedAreas}
        retainedPendingReviews={retainedPendingReviews}
        missingDeletedReviewContent={missingDeletedReviewContent}
        deletedReviewProvisionCapacity={deletedReviewProvisionCapacity}
        onExportSnapshot={onExportSnapshot}
        onExportBackup={onExportBackup}
        onOpenLibrary={onOpenLibrary}
      />
      <Accordion type="single" collapsible>
        <AccordionItem value="history">
          <AccordionTrigger>Review history ({totalReviewEvents})</AccordionTrigger>
          <AccordionContent>
            <p className="text-sm text-[var(--muted)]">
              Last 7 days: {week.ratings.again} Again · {week.ratings.hard} Hard ·{" "}
              {week.ratings.good} Good · {week.ratings.easy} Easy
            </p>
            <RecallDashboardReviewHistory events={reviewHistory} total={totalReviewEvents} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
