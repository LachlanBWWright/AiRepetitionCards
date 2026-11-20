import { RecallDashboardDeckToolbar } from "../library/RecallDashboardDeckToolbar";
import { isSubjectActivity } from "@recall/application";
import { SubjectHomeLink } from "../navigation/SubjectHomeLink";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { DashboardView } from "../navigation/dashboard-navigation";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
const modes = ["overview", "review", "tutor", "improve"] as const;
export function RecallSubjectHeader({ model }: { readonly model: RecallDashboardModel }) {
  const mode =
    model.activeView === DashboardView.Tutor
      ? "tutor"
      : model.activeView === DashboardView.Improve
        ? "improve"
        : model.practiceId
          ? "review"
          : "overview";
  const chat =
    model.activeView === DashboardView.Tutor || model.activeView === DashboardView.Improve;
  return (
    <header
      className={
        chat
          ? "flex w-full shrink-0 items-center justify-between gap-4 border-b px-4 py-3 sm:px-6"
          : "mx-auto flex w-full max-w-[1080px] flex-wrap items-start justify-between gap-4 px-4 pt-5 sm:px-8 sm:pt-8"
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        <SubjectHomeLink
          onNavigate={() => {
            model.setActiveView(DashboardView.Today);
          }}
        >
          Subjects
        </SubjectHomeLink>
        <h1
          className={
            chat
              ? "truncate text-lg font-semibold"
              : "break-words text-2xl font-semibold tracking-tight sm:text-3xl"
          }
        >
          {model.practiceId === "all"
            ? "Review all due"
            : (model.area?.title ?? "Subject unavailable")}
        </h1>
      </div>
      <Select
        value={mode}
        onValueChange={(value) => {
          if (isSubjectActivity(value) && model.area) model.openSubject(model.area.id, value);
        }}
        disabled={model.reviewSaving || model.reviewSaveFailed || !model.area}
      >
        <SelectTrigger
          className={chat ? "w-40 shrink-0" : "w-32 shrink-0 sm:w-44"}
          aria-label="Subject activity"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {modes.map((value) => (
            <SelectItem key={value} value={value}>
              {value[0]?.toUpperCase()}
              {value.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {mode === "overview" && <RecallDashboardDeckToolbar model={model} />}
    </header>
  );
}
