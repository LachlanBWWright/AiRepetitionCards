"use client";

import {
  cardVersionHistory,
  workspaceAuthoringBaseline,
  type CardDuplicateCandidate,
  type WorkspaceAuthoringCommand,
} from "@recall/application";
import type { CardVersion, LearningArea, Assessment, Workspace } from "@recall/domain";
import { useId, useState } from "react";
import { getKnowledgeAreaCardLibraryFilteredCards } from "./KnowledgeAreaCardLibraryDerivations";
import { KnowledgeAreaCardLibraryTools } from "./KnowledgeAreaCardLibraryTools";
import { Button } from "@recall/ui-web";
import { EmptyState } from "../../ui/EmptyState";
import { KnowledgeAreaCardLibraryBulkPanel } from "./bulk/KnowledgeAreaCardLibraryBulkPanel";
import { KnowledgeAreaCardLibraryDeletedRecovery } from "./recovery/KnowledgeAreaCardLibraryDeletedRecovery";
import { KnowledgeAreaCardLibraryTable } from "./table/KnowledgeAreaCardLibraryTable";
import { useKnowledgeAreaCardLibraryBulkActions } from "./bulk/KnowledgeAreaCardLibraryBulkActions";

type KnowledgeAreaCardLibraryProps = {
  readonly flaggedOnly?: boolean;
  readonly onFlaggedFilterChange?: (value: boolean) => void;
  readonly flaggedCardIds?: readonly string[];
  readonly onFlag?: (id: string) => void;
  readonly onBulk?: (
    command: WorkspaceAuthoringCommand,
    baseline: string | undefined,
  ) => Promise<{ readonly ok: boolean; readonly message?: string }>;
  readonly area: LearningArea;
  readonly onEdit: (card: Assessment) => void;
  readonly onDelete: (card: Assessment) => void;
  readonly onAdd: () => void;
  readonly workspace?: Workspace;
  readonly onRestoreVersion?: (
    version: CardVersion,
    expectedBaseline: string | undefined,
  ) => Promise<boolean>;
  readonly restoring?: boolean;
  readonly showDeletedRecovery?: boolean;
  readonly onOpenDuplicate?: (candidate: CardDuplicateCandidate) => void;
};

export function KnowledgeAreaCardLibrary({
  area,
  flaggedCardIds = [],
  flaggedOnly: requestedFlaggedOnly,
  onFlaggedFilterChange,
  onFlag,
  onBulk,
  onEdit,
  onDelete,
  onAdd,
  workspace,
  onRestoreVersion,
  restoring = false,
  showDeletedRecovery = true,
  onOpenDuplicate,
}: KnowledgeAreaCardLibraryProps) {
  const bulkActions = useKnowledgeAreaCardLibraryBulkActions({ area, workspace, onBulk });
  const { selectedIds, setSelected, bulkPending } = bulkActions;
  const [localFlaggedOnly, setLocalFlaggedOnly] = useState(false);
  const flaggedOnly = requestedFlaggedOnly ?? localFlaggedOnly;
  const setFlaggedOnly = (value: boolean) => {
    setLocalFlaggedOnly(value);
    onFlaggedFilterChange?.(value);
  };
  const clearFilters = () => {
    setSearch("");
    setObjectiveFilter("");
    setFlaggedOnly(false);
  };
  const fieldId = useId();
  const deletedVersions = workspace
    ? cardVersionHistory(workspace, area.id).filter(
        (version, index, versions) =>
          !area.cards.some((card) => card.id === version.cardId) &&
          versions.findIndex((item) => item.cardId === version.cardId) === index,
      )
    : [];
  const baselineForVersion = (version: CardVersion) =>
    workspace
      ? workspaceAuthoringBaseline(workspace, {
          kind: "restore-card",
          areaId: version.areaId,
          cardId: version.cardId,
          versionId: version.id,
        })
      : undefined;
  const [search, setSearch] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState("");
  const objectives = area.objectives ?? [];
  const legacyObjectives = [...new Set(area.cards.map((card) => card.objective))].filter(
    (title) => !objectives.some((objective) => objective.title === title),
  );
  const filteredCards = getKnowledgeAreaCardLibraryFilteredCards(
    area,
    search,
    objectiveFilter,
    flaggedOnly,
    flaggedCardIds,
  );

  return (
    <section aria-label="Card library" className="mt-0">
      {onBulk && (
        <KnowledgeAreaCardLibraryBulkPanel
          area={area}
          workspace={workspace}
          restoring={restoring}
          actions={bulkActions}
        />
      )}
      {showDeletedRecovery && (
        <KnowledgeAreaCardLibraryDeletedRecovery
          versions={deletedVersions}
          area={area}
          workspace={workspace}
          restoring={restoring}
          onRestoreVersion={onRestoreVersion}
          baselineForVersion={baselineForVersion}
        />
      )}
      <KnowledgeAreaCardLibraryTools
        area={area}
        workspace={workspace}
        fieldId={fieldId}
        search={search}
        setSearch={setSearch}
        objectiveFilter={objectiveFilter}
        setObjectiveFilter={setObjectiveFilter}
        objectives={objectives}
        legacyObjectives={legacyObjectives}
        flaggedOnly={flaggedOnly}
        setFlaggedOnly={setFlaggedOnly}
        flaggedCardIds={flaggedCardIds}
        onFlag={onFlag}
        restoring={restoring}
        onEdit={onEdit}
        onOpenDuplicate={onOpenDuplicate}
      />
      {filteredCards.length > 0 ? (
        <KnowledgeAreaCardLibraryTable
          area={area}
          cards={filteredCards}
          selectedIds={selectedIds}
          setSelected={setSelected}
          onBulk={onBulk}
          restoring={restoring}
          bulkPending={bulkPending}
          flaggedCardIds={flaggedCardIds}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          onFlag={onFlag}
          workspace={workspace}
          onRestoreVersion={onRestoreVersion}
          baselineForVersion={baselineForVersion}
        />
      ) : (
        <EmptyState
          title={area.cards.length === 0 ? "Start your card library" : "No matching cards"}
          description={
            area.cards.length === 0
              ? "Add your first question and answer to start studying."
              : "Try another search or learning objective."
          }
          action={
            area.cards.length === 0 ? (
              <Button size="small" onClick={onAdd}>
                Add a card
              </Button>
            ) : (
              <Button size="small" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            )
          }
        />
      )}
      <p className="mt-4 text-xs text-[var(--muted)]" role="status" aria-live="polite">
        Showing {filteredCards.length} of {area.cards.length} cards
      </p>
    </section>
  );
}
