import { DailyReviewSummary } from "./DailyReviewSummary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { useState } from "react";
import {
  summarizeStudySubjects,
  subjectSortOptions,
  isSubjectSort,
  type SubjectSort,
} from "@recall/application";
import { Button } from "@/components/ui/Button";
import { Input } from "@recall/ui-web";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { Plus, Ellipsis } from "lucide-react";
import { RecallSubjectRow } from "./RecallSubjectRow";
import { RecallDashboardResumeADraft } from "../authoring/drafts/RecallDashboardResumeADraft";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
const sortItems = subjectSortOptions.map((option) => (
  <SelectItem key={option.value} value={option.value}>
    {option.label}
  </SelectItem>
));
export function RecallDashboardHome({ model }: { readonly model: RecallDashboardModel }) {
  const [sort, setSort] = useState<SubjectSort>("daily");
  const [search, setSearch] = useState("");
  const rows = summarizeStudySubjects(
    model.workspace,
    model.now.getTime(),
    sort,
    model.deepPracticeRecommendations.map((item) => item.activity.areaId),
    search,
  );
  const disabled = model.reviewSaving || model.reviewSaveFailed;
  const openImport = () => {
    model.setLibraryTools("import");
    model.setImportExportOpen(true);
  };
  const openBrowse = () => {
    model.setSharingTab("browse");
    model.setShareKnowledgeOpen(true);
  };
  const emptyAction = search ? (
    <Button
      variant="secondary"
      onClick={() => {
        setSearch("");
      }}
    >
      Clear search
    </Button>
  ) : (
    <Button onClick={model.addArea}>New subject</Button>
  );
  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-[1080px] flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Your subjects</h1>
          <p className="text-sm text-muted-foreground">
            {model.studiedToday} reviewed today · {model.practice.week.inWindow} this week
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {model.workspace.areas.length > 0 && (
            <Button variant="secondary" disabled={disabled} onClick={model.addArea}>
              <Plus aria-hidden="true" />
              New subject
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={disabled}
                size="icon"
                aria-label="More subject actions"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openImport}>Import cards</DropdownMenuItem>
              <DropdownMenuItem onSelect={openBrowse}>Browse shared decks</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {model.workspace.areas.length > 0 && (
        <DailyReviewSummary
          due={model.dueCount}
          disabled={disabled}
          onReview={() => {
            model.startPractice("all");
          }}
        />
      )}
      {model.workspace.areas.length > 0 && (
        <section
          className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3 sm:flex sm:items-center sm:justify-between"
          aria-label="Subject filters"
        >
          <Input
            aria-label="Find a subject"
            type="search"
            placeholder="Find a subject…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="w-full min-w-0 sm:max-w-sm sm:flex-1"
          />
          <Select
            value={sort}
            onValueChange={(value) => {
              if (isSubjectSort(value)) setSort(value);
            }}
          >
            <SelectTrigger aria-label="Sort subjects" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{sortItems}</SelectContent>
          </Select>
        </section>
      )}
      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Subjects">
        {rows.map((row) => (
          <RecallSubjectRow
            key={row.area.id}
            row={row}
            disabled={disabled}
            onOpen={(activity) => {
              model.openSubject(row.area.id, activity);
            }}
          />
        ))}
        {rows.length === 0 && (
          <div className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-10 sm:py-14">
            <h2 className="text-lg font-semibold">
              {search ? "No matching subjects" : "Create your first subject"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {search
                ? "Try another name or clear your search."
                : "Choose something you’re learning. Give it a name, then add your first card."}
            </p>
            {emptyAction}
          </div>
        )}
      </section>
      {model.libraryNotes.notes.drafts.length > 0 && <RecallDashboardResumeADraft model={model} />}
    </main>
  );
}
