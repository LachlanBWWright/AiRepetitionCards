import { RecallDashboardDeckToolbar } from "../library/RecallDashboardDeckToolbar";
import { isSubjectActivity } from "@recall/application";
import { Button } from "@/components/ui/Button";
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
          : "mx-auto flex w-full max-w-[1080px] flex-wrap items-start justify-between gap-x-6 gap-y-5 px-4 pt-8 sm:px-8 sm:pt-10"
      }
    >
      <div className="min-w-0">
        <Button
          variant="link"
          className="h-auto p-0 text-muted-foreground"
          onClick={() => {
            model.setActiveView(DashboardView.Today);
          }}
        >
          {chat ? "Subjects" : "Home / Subjects"}
        </Button>
        <h1
          className={
            chat
              ? "truncate text-lg font-semibold"
              : "mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl"
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
        <SelectTrigger className="w-44" aria-label="Subject activity">
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
