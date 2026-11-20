import { WorkloadComparison } from "./WorkloadComparison";
import { Label } from "@recall/ui-web/components/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@recall/ui-web/components/table";
import { useStudyPlanner } from "@recall/react";
import type { Workspace } from "@recall/domain";
import { Input, Button } from "@recall/ui-web";
export function StudyPlanner({
  workspace,
  now,
  areaId,
}: {
  readonly workspace: Workspace;
  readonly now: number;
  readonly areaId?: string | undefined;
}) {
  const planner = useStudyPlanner(workspace, now, areaId);
  return (
    <section
      className="flex w-full min-w-0 max-w-3xl flex-col gap-4"
      aria-label="Workload simulator"
    >
      <p className="max-w-prose text-sm text-muted-foreground">
        Estimate repeat reviews, forgetting and study time from your current memory states.
        Scenarios use your study-day boundary, sibling-burying policy and reduced-load weekdays.
        Compare target retention to see its effect on workload.
      </p>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {planner.fields.map((field) => (
          <Label
            key={field.label}
            className="grid min-w-0 content-start gap-2 leading-5 sm:row-span-2 sm:grid-rows-subgrid"
          >
            <span>{field.label}</span>
            <Input
              className="w-full min-w-0"
              type="number"
              value={field.value}
              onChange={(event) => {
                field.set(event.target.value);
              }}
            />
          </Label>
        ))}
      </div>
      <Button className="w-full sm:w-auto sm:self-start" variant="default" onClick={planner.run}>
        Simulate workload
      </Button>
      {planner.message && <p role="status">{planner.message}</p>}
      <WorkloadComparison scenarios={planner.comparisons} />
      {planner.result && <SimulationResult result={planner.result} />}
    </section>
  );
}

function SimulationResult({
  result,
}: {
  readonly result: import("@recall/application").WorkloadSimulation;
}) {
  const rows = result.days.map((day) => (
    <TableRow key={day.day}>
      <TableCell>{day.day}</TableCell>
      <TableCell>{day.reviews}</TableCell>
      <TableCell>{day.minutes.toFixed(1)}</TableCell>
      <TableCell>{day.backlog}</TableCell>
      <TableCell>{day.buried}</TableCell>
    </TableRow>
  ));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p>
        {result.totalReviews} answers · {result.totalMinutes.toFixed(0)} minutes ·{" "}
        {result.days.at(-1)?.backlog ?? 0} overdue at the end. Uses{" "}
        {result.averageSeconds.toFixed(1)} seconds/answer (
        {result.timingEstimated ? "default estimate" : "recorded timing"}).
      </p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        {result.assumptions.map((assumption) => (
          <li key={assumption}>{assumption}</li>
        ))}
      </ul>
      <div className="max-h-64 overflow-y-auto">
        <Table className="w-full text-sm">
          <TableCaption>Simulated daily workload</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Answers</TableHead>
              <TableHead>Minutes</TableHead>
              <TableHead>Backlog</TableHead>
              <TableHead>Buried siblings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </div>
    </div>
  );
}
