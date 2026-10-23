import type { ReviewRating } from "@recall/scheduler";
import { EmptyState } from "@/components/ui/EmptyState";

export type DashboardReviewHistoryEntry = {
  readonly id: string;
  readonly rating: ReviewRating;
  readonly question: string;
  readonly areaTitle: string;
  readonly hasConcurrentBranch: boolean;
  readonly needsSyncRetry: boolean;
  readonly retainedForSync: boolean;
  readonly ratedAt: string;
};

function syncStatusLabel(event: DashboardReviewHistoryEntry): string | null {
  if (event.retainedForSync) return "Deleted · pending sync";
  if (event.needsSyncRetry) return "Waiting to sync";
  if (event.hasConcurrentBranch) return "Pending sync";
  return null;
}

function formatRatedAt(value: string): string {
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function SyncStatus({ event }: { readonly event: DashboardReviewHistoryEntry }) {
  const label = syncStatusLabel(event);
  return label ? <span className="ml-2 text-[var(--status-warning-fg)]">{label}</span> : null;
}

export function RecallDashboardReviewHistory({
  events,
  total,
}: {
  readonly events: readonly DashboardReviewHistoryEntry[];
  readonly total: number;
}) {
  return (
    <section
      className="mt-6 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
      aria-labelledby="review-history-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold" id="review-history-title">
            Recent reviews
          </h2>
        </div>
        <span className="text-sm text-[var(--muted)]">{total} total</span>
      </div>
      {events.length ? (
        <ol className="divide-y divide-[var(--line)]">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid gap-x-4 gap-y-1.5 px-6 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
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
                <SyncStatus event={event} />
              </span>
              <time
                className="text-sm text-[var(--muted)] sm:col-start-3 sm:row-span-2 sm:row-start-1"
                dateTime={event.ratedAt}
              >
                {formatRatedAt(event.ratedAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          className="px-6 py-10 text-[var(--muted)]"
          title="No reviews yet"
          description="Your completed reviews will appear here."
        />
      )}
    </section>
  );
}
