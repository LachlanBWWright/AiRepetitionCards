import type { Assessment } from "@recall/domain";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { Ellipsis } from "lucide-react";
import type { KnowledgeAreaCardLibraryTableProps } from "./KnowledgeAreaCardLibraryTable";
import { KnowledgeAreaCardLibraryQuestion } from "./KnowledgeAreaCardLibraryQuestion";
import { KnowledgeAreaCardLibrarySelectionCell } from "./KnowledgeAreaCardLibrarySelectionCell";

type KnowledgeAreaCardLibraryTableRowProps = Pick<
  KnowledgeAreaCardLibraryTableProps,
  | "area"
  | "setSelected"
  | "restoring"
  | "bulkPending"
  | "onEdit"
  | "onDelete"
  | "onFlag"
  | "workspace"
  | "onRestoreVersion"
  | "baselineForVersion"
> & {
  readonly card: Assessment;
  readonly selected: boolean;
  readonly hasBulkAction: boolean;
  readonly flagged: boolean;
};

export function KnowledgeAreaCardLibraryTableRow({
  area,
  card,
  selected,
  setSelected,
  hasBulkAction,
  restoring,
  bulkPending,
  flagged,
  onEdit,
  onDelete,
  onFlag,
  workspace,
  onRestoreVersion,
  baselineForVersion,
}: KnowledgeAreaCardLibraryTableRowProps) {
  const flagCard = () => {
    onFlag?.(card.id);
  };

  return (
    <tr className="transition-colors hover:bg-[var(--surface-hover)]">
      {hasBulkAction && (
        <KnowledgeAreaCardLibrarySelectionCell
          selected={selected}
          disabled={restoring || bulkPending}
          label={`Select card: ${card.front}`}
          onChange={(checked) => {
            setSelected((current) =>
              checked
                ? [...new Set([...current, card.id])]
                : current.filter((id) => id !== card.id),
            );
          }}
        />
      )}
      <th className="max-w-0 px-4 py-5 text-left text-[15px] font-medium leading-6" scope="row">
        <KnowledgeAreaCardLibraryQuestion
          area={area}
          card={card}
          flagged={flagged}
          workspace={workspace}
          onRestoreVersion={onRestoreVersion}
          baselineForVersion={baselineForVersion}
          restoring={restoring}
        />
      </th>
      <td className="px-3 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ShadcnButton
              type="button"
              variant="secondary"
              size="icon"
              className="size-8 rounded-md border-transparent bg-transparent shadow-none hover:bg-[var(--surface-hover)]"
              aria-label={`Actions for card: ${card.front}`}
            >
              <Ellipsis aria-hidden="true" />
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                onEdit(card);
              }}
            >
              Edit card
            </DropdownMenuItem>
            {onFlag && (
              <DropdownMenuItem onSelect={flagCard}>
                {flagged ? "Remove editing flag" : "Improve later"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onDelete(card);
              }}
            >
              Delete card
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
