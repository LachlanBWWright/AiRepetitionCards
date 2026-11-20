import type { StudyStatistics } from "@recall/application";
import { StatisticsBars } from "./StatisticsBars";

export function StudyDistributions({ stats }: { readonly stats: StudyStatistics }) {
  return (
    <div className="grid min-w-0 gap-x-8 gap-y-8 md:grid-cols-2">
      <StatisticsBars
        title="Review intervals"
        description="Days between reviews"
        labelHeading="Interval (days)"
        valueHeading="Cards"
        rows={stats.intervals}
      />
      <StatisticsBars
        title="Memory stability"
        description="Estimated stability in days"
        labelHeading="Stability (days)"
        valueHeading="Cards"
        rows={stats.stability}
      />
      <StatisticsBars
        title="Difficulty"
        description="Scheduler difficulty score"
        labelHeading="Difficulty"
        valueHeading="Cards"
        rows={stats.difficulty}
      />
      <StatisticsBars
        title="Estimated recall"
        description="Recall probability (%)"
        labelHeading="Recall (%)"
        valueHeading="Cards"
        rows={stats.retrievability}
      />
    </div>
  );
}
