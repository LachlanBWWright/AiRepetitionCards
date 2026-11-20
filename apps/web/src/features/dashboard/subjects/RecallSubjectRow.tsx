import type { SubjectSummary, SubjectActivity } from "@recall/application";
import { Button } from "@/components/ui/Button";
import { BookOpen } from "lucide-react";
import { NavigationLink } from "@recall/ui-web";
import { dashboardRouteHref } from "../navigation/dashboard-route";
import { DashboardView } from "../navigation/dashboard-navigation";
export function RecallSubjectRow({
  row,
  disabled,
  onOpen,
}: {
  readonly row: SubjectSummary;
  readonly disabled: boolean;
  readonly onOpen: (activity: SubjectActivity) => void;
}) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 last:border-b-0 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: row.area.color }}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <NavigationLink
            href={dashboardRouteHref({ view: DashboardView.Library, areaId: row.area.id })}
            className="flex min-h-8 max-w-full items-center truncate text-base font-semibold"
            disabled={disabled}
            onNavigate={() => {
              onOpen("overview");
            }}
          >
            {row.area.title}
          </NavigationLink>
          <p className="text-sm text-muted-foreground">
            {row.area.cards.length} {row.area.cards.length === 1 ? "card" : "cards"} ·{" "}
            {row.due ? `${String(row.due)} due` : "Nothing due"}
            {row.suggested ? " · Follow-up available" : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2" aria-label={`Activities for ${row.area.title}`}>
        {row.due > 0 && (
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={disabled || row.due === 0}
            onClick={() => {
              onOpen("review");
            }}
          >
            <BookOpen className="hidden sm:block" aria-hidden="true" />
            Review
          </Button>
        )}
      </div>
    </article>
  );
}
