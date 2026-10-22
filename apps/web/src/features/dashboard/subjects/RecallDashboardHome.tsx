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
import { Plus } from "lucide-react";
import { RecallSubjectRow } from "./RecallSubjectRow";
import { RecallDashboardResumeADraft } from "../authoring/drafts/RecallDashboardResumeADraft";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
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
  return (
    <main className="mx-auto min-h-[80vh] w-full max-w-[1080px] space-y-7 px-4 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your subjects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {model.dueCount} cards due · {model.studiedToday} reviewed today ·{" "}
            {model.practice.week.inWindow} this week
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled} onClick={model.addArea}>
            <Plus aria-hidden="true" />
            New subject
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              model.setLibraryTools("import");
              model.setImportExportOpen(true);
            }}
          >
            Import cards
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              model.setSharingTab("browse");
              model.setShareKnowledgeOpen(true);
            }}
          >
            Browse shared decks
          </Button>
        </div>
      </header>
      <section
        className="flex flex-wrap items-center justify-between gap-4 border-y py-5"
        aria-label="Daily review"
      >
        <div>
          <h2 className="font-semibold">
            {model.dueCount ? "Ready for your daily review?" : "Your reviews are up to date"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review what’s due, or explore a subject with AI.
          </p>
        </div>
        <Button
          disabled={disabled || model.dueCount === 0}
          onClick={() => {
            model.startPractice("all");
          }}
        >
          Review all due
        </Button>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Find a subject"
          placeholder="Find a subject…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="max-w-sm"
        />
        <Select
          value={sort}
          onValueChange={(value) => {
            if (isSubjectSort(value)) setSort(value);
          }}
        >
          <SelectTrigger aria-label="Sort subjects" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {subjectSortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
          <div className="space-y-3 p-8">
            <h2 className="text-lg font-semibold">
              {search ? "No matching subjects" : "Create your first subject"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {search
                ? "Try another name or clear your search."
                : "Start with a name. Add cards or materials, or let AI help you explore what to learn."}
            </p>
            {!search && <Button onClick={model.addArea}>New subject</Button>}
          </div>
        )}
      </section>
      {model.libraryNotes.notes.drafts.length > 0 && <RecallDashboardResumeADraft model={model} />}
    </main>
  );
}
