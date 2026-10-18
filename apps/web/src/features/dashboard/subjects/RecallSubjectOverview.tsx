import { Tabs, TabsList, TabsTrigger, TabsContent } from "@recall/ui-web/components/tabs";
import { RecallDashboardCardLibrary } from "../library/RecallDashboardCardLibrary";
import { RecallDashboardReviewHistory } from "../review/RecallDashboardReviewHistory";
import { summarizeDashboardReviews } from "../review/RecallDashboardReviewSummary";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallSubjectOverview({ model }: { readonly model: RecallDashboardModel }) {
  const area = model.area;
  if (!area)
    return (
      <p className="p-8">This subject is no longer available. Choose another subject from Home.</p>
    );
  const events = (model.workspace.reviewEvents ?? []).filter((event) => event.areaId === area.id);
  const summary = summarizeDashboardReviews(
    { ...model.workspace, reviewEvents: events },
    area,
    model.now,
  );
  return (
    <div
      className="mx-auto w-full max-w-[1080px] px-4 pb-12 pt-6 sm:px-8"
      inert={model.reviewSaving || model.reviewSaveFailed}
    >
      <Tabs
        value={model.subjectSection}
        onValueChange={(value) => {
          if (value === "cards" || value === "materials" || value === "progress")
            model.setSubjectSection(value);
        }}
      >
        <TabsList
          className="h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent p-0"
          aria-label="Subject overview"
        >
          {(["cards", "materials", "progress"] as const).map((section) => (
            <TabsTrigger
              key={section}
              value={section}
              className="flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pb-3 pt-1 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {section === "cards" ? "Cards" : section === "materials" ? "Materials" : "Progress"}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="cards" forceMount className="pt-7 data-[state=inactive]:hidden">
          <RecallDashboardCardLibrary model={model} />
        </TabsContent>
        <TabsContent value="materials" className="pt-6">
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Keep source material and concepts together. AI suggestions remain proposals until you
            approve them.
          </p>
        </TabsContent>
        <TabsContent value="progress" className="space-y-5">
          <p className="mt-4 text-sm text-muted-foreground">
            {events.length} reviews · {summary.studiedToday} today ·{" "}
            {summary.practice.week.inWindow} this week
          </p>
          <RecallDashboardReviewHistory events={summary.reviewHistory} total={events.length} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
