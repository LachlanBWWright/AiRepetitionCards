import type { WorkloadSimulation } from "@recall/application";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from "@recall/ui-web/components/table";

export function WorkloadComparison({
  scenarios,
}: {
  readonly scenarios: readonly WorkloadSimulation[];
}) {
  if (scenarios.length === 0) return null;
  const rows = scenarios.map((scenario) => (
    <TableRow key={scenario.targetRetention}>
      <TableCell>{Math.round(scenario.targetRetention * 100)}%</TableCell>
      <TableCell>{scenario.totalReviews}</TableCell>
      <TableCell>{scenario.totalMinutes.toFixed(0)}</TableCell>
      <TableCell>
        {scenario.expectedRetention === null
          ? "No reviewed cards"
          : `${(scenario.expectedRetention * 100).toFixed(1)}%`}
      </TableCell>
    </TableRow>
  ));
  return (
    <Table>
      <TableCaption>
        Same collection and limits at different retention targets; seeded estimates.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Target retention</TableHead>
          <TableHead>Answers</TableHead>
          <TableHead>Minutes</TableHead>
          <TableHead>Final predicted recall</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows}</TableBody>
    </Table>
  );
}
