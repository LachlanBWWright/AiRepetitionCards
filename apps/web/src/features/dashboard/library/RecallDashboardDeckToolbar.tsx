import { Button } from "@/components/ui/Button";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { BookOpen, Ellipsis } from "lucide-react";
import { studyQueue, localStudyDay } from "@recall/application";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardDeckToolbar({ model }: { readonly model: RecallDashboardModel }) {
  const {
    libraryDeckOpen,
    area,
    now,
    startPractice,
    setLibraryTools,
    setImportExportOpen,
    setSharingTab,
    setShareKnowledgeOpen,
    editArea,
    setShowAreaSettings,
    deleteArea,
  } = model;
  const dueCount = area
    ? studyQueue(
        model.workspace,
        area,
        now.getTime(),
        localStudyDay(now.getTime(), model.workspace.schedulerSettings?.studyDayStartHour),
      ).cards.length
    : 0;
  return (
    <section
      aria-label="Subject tools"
      className="flex w-full min-w-0 flex-wrap items-center gap-3"
      hidden={!libraryDeckOpen || !area}
    >
      <p className="flex-1 whitespace-nowrap text-sm text-muted-foreground">
        {area?.cards.length ?? 0} {area?.cards.length === 1 ? "card" : "cards"}
        <span className="mx-3 text-border" aria-hidden="true">
          /
        </span>
        {dueCount} due
      </p>
      {area && dueCount > 0 && (
        <Button
          onClick={() => {
            startPractice(area.id);
          }}
        >
          <BookOpen aria-hidden="true" className="size-4" />
          Review {dueCount} due
        </Button>
      )}
      {area && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ShadcnButton
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 gap-2"
              aria-label={`Manage ${area.title}`}
            >
              <Ellipsis aria-hidden="true" />
              Manage
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setLibraryTools("export");
                setImportExportOpen(true);
              }}
            >
              Export deck
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setSharingTab("publish");
                setShareKnowledgeOpen(true);
              }}
            >
              Share knowledge
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                editArea(area);
              }}
            >
              Edit subject
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setShowAreaSettings(true);
              }}
            >
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void deleteArea(area)}>
              Delete subject
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  );
}
