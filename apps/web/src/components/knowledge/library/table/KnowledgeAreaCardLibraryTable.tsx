import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
} from "@recall/ui-web/components/table";
import type { CardVersion, LearningArea, Assessment, Workspace } from "@recall/domain";
import type { WorkspaceAuthoringCommand } from "@recall/application";
import { KnowledgeAreaCardLibraryTableRow } from "./KnowledgeAreaCardLibraryTableRow";
import { KnowledgeAreaCardLibrarySelectionHeader } from "./KnowledgeAreaCardLibrarySelectionHeader";

export type KnowledgeAreaCardLibraryTableProps = {
  readonly area: LearningArea;
  readonly cards: readonly Assessment[];
  readonly selectedIds: readonly string[];
  readonly setSelected: (update: (current: readonly string[]) => readonly string[]) => void;
  readonly onBulk:
    | ((
        command: WorkspaceAuthoringCommand,
        baseline: string | undefined,
      ) => Promise<{ readonly ok: boolean; readonly message?: string }>)
    | undefined;
  readonly restoring: boolean;
  readonly bulkPending: boolean;
  readonly flaggedCardIds: readonly string[];
  readonly onAdd: () => void;
  readonly onEdit: (card: Assessment) => void;
  readonly onDelete: (card: Assessment) => void;
  readonly onFlag: ((id: string) => void) | undefined;
  readonly workspace: Workspace | undefined;
  readonly onRestoreVersion:
    ((version: CardVersion, expectedBaseline: string | undefined) => Promise<boolean>) | undefined;
  readonly baselineForVersion: (version: CardVersion) => string | undefined;
};

export function KnowledgeAreaCardLibraryTable({
  area,
  cards,
  selectedIds,
  setSelected,
  onBulk,
  restoring,
  bulkPending,
  flaggedCardIds,
  onEdit,
  onDelete,
  onFlag,
  workspace,
  onRestoreVersion,
  baselineForVersion,
}: KnowledgeAreaCardLibraryTableProps) {
  const selectVisibleCards = (checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...cards.map((card) => card.id)])]
        : current.filter((id) => !cards.some((card) => card.id === id)),
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <Table className="w-full table-fixed border-collapse text-sm" aria-label="Cards">
        <TableHeader className="border-b border-[var(--line)] bg-transparent text-left text-xs font-medium text-[var(--muted)]">
          <TableRow>
            {onBulk && (
              <KnowledgeAreaCardLibrarySelectionHeader
                allSelected={cards.every((card) => selectedIds.includes(card.id))}
                someSelected={cards.some((card) => selectedIds.includes(card.id))}
                disabled={restoring || bulkPending}
                onChange={selectVisibleCards}
              />
            )}
            <TableHead className="px-4 py-4" scope="col">
              Question
            </TableHead>
            <TableHead className="w-14 px-3 py-4" scope="col">
              <span className="sr-only">Card actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-[var(--line)]">
          {cards.map((card) => (
            <KnowledgeAreaCardLibraryTableRow
              key={card.id}
              area={area}
              card={card}
              selected={selectedIds.includes(card.id)}
              setSelected={setSelected}
              hasBulkAction={Boolean(onBulk)}
              restoring={restoring}
              bulkPending={bulkPending}
              flagged={flaggedCardIds.includes(card.id)}
              onEdit={onEdit}
              onDelete={onDelete}
              onFlag={onFlag}
              workspace={workspace}
              onRestoreVersion={onRestoreVersion}
              baselineForVersion={baselineForVersion}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
