import type { StudyStatistics } from "@recall/application";
import { StatisticsBars } from "./StatisticsBars";

export function StudyMemoryDetails({ stats }: { readonly stats: StudyStatistics }) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-sm text-muted-foreground">Cards remembered</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            About {Math.round(stats.estimatedRemembered)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-sm text-muted-foreground">Reviews per day</dt>
          <dd className="text-2xl font-semibold tabular-nums">{stats.dailyLoad.toFixed(1)}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-sm text-muted-foreground">Recorded study time</dt>
          <dd className="text-2xl font-semibold">
            {stats.timedReviews ? `${(stats.elapsedMs / 60_000).toFixed(1)} min` : "No timing data"}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-sm text-muted-foreground">Timed reviews</dt>
          <dd className="text-2xl font-semibold tabular-nums">{stats.timedReviews}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {stats.newCards} new · {stats.learningCards} learning · {stats.reviewCards} review ·{" "}
        {stats.suspendedCards} suspended cards. Memory and daily load are scheduler estimates.
      </p>
      <div className="grid min-w-0 gap-8 md:grid-cols-2">
        <StatisticsBars
          title="Upcoming due dates"
          description="Next 30 days"
          emptyMessage="No cards are scheduled in the next 30 days."
          rows={stats.forecast}
        />
        <StatisticsBars
          title="Recorded study time"
          description="Daily minutes"
          valueHeading="Minutes"
          rows={stats.calendar.map((day) => ({
            label: day.label,
            count: Math.round(day.elapsedMs / 600) / 100,
          }))}
        />
      </div>
    </>
  );
}
