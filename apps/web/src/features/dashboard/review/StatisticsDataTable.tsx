import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@recall/ui-web/components/table";

export function StatisticsDataTable({
  title,
  labelHeading,
  valueHeading,
  rows,
}: {
  readonly title: string;
  readonly labelHeading: string;
  readonly valueHeading: string;
  readonly rows: readonly { readonly label: string; readonly count: number }[];
}) {
  return (
    <div className="max-h-52 overflow-y-auto rounded-md border border-border">
      <Table aria-label={`${title} values`}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{labelHeading}</TableHead>
            <TableHead scope="col" className="text-right">
              {valueHeading}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
