import { browserCell, type BrowserColumn, type StudyCardMatch } from "@recall/application";
import { Button } from "@recall/ui-web";
export function CardBrowserTable({
  entries,
  columns,
  page,
  onSelect,
}: {
  readonly entries: readonly StudyCardMatch[];
  readonly columns: readonly BrowserColumn[];
  readonly page: number;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Cards, page {page + 1}</caption>
        <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
          <tr className="border-b border-border last:border-0">
            {columns.map((column) => (
              <th key={column} className="px-3 py-3 font-medium">
                {columnLabels[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <CardBrowserRow
              key={entry.card.id}
              entry={entry}
              columns={columns}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardBrowserRow({
  entry,
  columns,
  onSelect,
}: {
  readonly entry: import("@recall/application").StudyCardMatch;
  readonly columns: readonly BrowserColumn[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      {columns.map((column, index) => (
        <td key={column} className="max-w-60 whitespace-pre-wrap break-words px-3 py-3 align-top">
          {column === "front" || (!columns.includes("front") && index === 0) ? (
            <Button
              variant="link"
              className="h-auto justify-start whitespace-normal p-0 text-left text-sm text-foreground"
              aria-label={`Inspect related cards: ${entry.card.front.slice(0, 90)}`}
              onClick={() => {
                onSelect(entry.card.id);
              }}
            >
              {displayCell(entry, column)}
            </Button>
          ) : (
            displayCell(entry, column)
          )}
        </td>
      ))}
    </tr>
  );
}

export const columnLabels: Readonly<Record<BrowserColumn, string>> = {
  subject: "Subject",
  front: "Question",
  back: "Answer",
  due: "Due",
  interval: "Interval",
  lapses: "Lapses",
  tags: "Tags",
  state: "Status",
};
function displayCell(
  entry: import("@recall/application").StudyCardMatch,
  column: BrowserColumn,
): string {
  const raw = browserCell(entry, column);
  if (column === "interval") return `${raw} days`;
  if (column === "due") {
    const date = new Date(raw);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : "Date unavailable";
  }
  return raw;
}
