import { StatisticsDataTable } from "./StatisticsDataTable";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";

export function StatisticsBars({
  title,
  rows,
  labelHeading = "Date",
  valueHeading = "Reviews",
  description,
  emptyMessage = "No recorded values in this range.",
}: {
  readonly title: string;
  readonly labelHeading?: string;
  readonly valueHeading?: string;
  readonly description?: string;
  readonly emptyMessage?: string;
  readonly rows: readonly { readonly label: string; readonly count: number }[];
}) {
  if (!rows.some((row) => row.count > 0)) {
    return (
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </section>
    );
  }
  const maximum = Math.max(...rows.map((row) => row.count));
  const width = Math.max(1, 720 / Math.max(1, rows.length));
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <p className="text-sm text-muted-foreground tabular-nums">
        Peak: {maximum} · Total: {rows.reduce((sum, row) => sum + row.count, 0)}
      </p>
      <svg
        viewBox="0 0 720 140"
        role="img"
        aria-label={`${title}: ${String(rows.reduce((sum, row) => sum + row.count, 0))} total`}
        className="h-40 w-full overflow-visible sm:h-44"
        preserveAspectRatio="none"
      >
        {[10, 70, 130].map((y) => (
          <line
            key={y}
            x1={0}
            y1={y}
            x2={720}
            y2={y}
            stroke="currentColor"
            opacity={0.12}
            strokeDasharray={y === 130 ? undefined : "3 5"}
          />
        ))}
        {rows.map((row, index) => (
          <rect
            key={row.label}
            x={index * width}
            y={130 - (row.count / maximum) * 120}
            width={Math.max(0.5, width - 2)}
            height={(row.count / maximum) * 120}
            fill="currentColor"
            className="text-primary"
          >
            <title>
              {row.label}: {row.count}
            </title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{rows[0]?.label}</span>
        <span>{rows.at(-1)?.label}</span>
      </div>
      <Accordion type="single" collapsible className="min-w-0">
        <AccordionItem value="values">
          <AccordionTrigger aria-label={`${title}: show data table`} variant="compact">
            Show data table
          </AccordionTrigger>
          <AccordionContent className="pb-0 pt-2">
            <StatisticsDataTable
              title={title}
              labelHeading={labelHeading}
              valueHeading={valueHeading}
              rows={rows}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
