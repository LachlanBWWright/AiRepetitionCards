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
    <section className="grid gap-3 border-t pt-4" aria-label="Workload simulator">
      <h3 className="font-semibold">Workload simulator</h3>
      <p>
        Estimate repeat reviews, forgetting and study time from your current memory states. This
        seeded scenario uses 24-hour days and the limits below; it does not model sibling burying or
        reduced-load weekdays.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {planner.fields.map((field) => (
          <label key={field.label}>
            {field.label}
            <Input
              type="number"
              value={field.value}
              onChange={(event) => {
                field.set(event.target.value);
              }}
            />
          </label>
        ))}
      </div>
      <Button variant="secondary" onClick={planner.run}>
        Simulate workload
      </Button>
      {planner.message && <p role="status">{planner.message}</p>}
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
    <tr key={day.day}>
      <td>{day.day}</td>
      <td>{day.reviews}</td>
      <td>{day.minutes.toFixed(1)}</td>
      <td>{day.backlog}</td>
    </tr>
  ));
  return (
    <div className="grid gap-3">
      <p>
        {result.totalReviews} answers · {result.totalMinutes.toFixed(0)} minutes ·{" "}
        {result.days.at(-1)?.backlog ?? 0} overdue at the end. Uses{" "}
        {result.averageSeconds.toFixed(1)} seconds/answer (
        {result.timingEstimated ? "default estimate" : "recorded timing"}).
      </p>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <caption>Simulated daily workload</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Answers</th>
              <th>Minutes</th>
              <th>Backlog</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}
