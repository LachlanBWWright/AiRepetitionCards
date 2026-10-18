"use client";

import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import { useState } from "react";
import { getKnowledgeAreaCardLibraryDuplicates } from "./KnowledgeAreaCardLibraryDerivations";
import { Ellipsis, Search } from "lucide-react";
import { KnowledgeAreaCardLibraryDuplicateResults } from "./duplicates/KnowledgeAreaCardLibraryDuplicateResults";
import { KnowledgeAreaCardLibraryObjectiveFilter } from "./KnowledgeAreaCardLibraryObjectiveFilter";
import { KnowledgeAreaCardLibraryDuplicateScopeSelect } from "./duplicates/KnowledgeAreaCardLibraryDuplicateScope";
import { Input } from "@recall/ui-web";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import { Collapsible, CollapsibleContent } from "@recall/ui-web/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";

type KnowledgeAreaCardLibraryToolsProps = {
  readonly area: LearningArea;
  readonly workspace: Workspace | undefined;
  readonly fieldId: string;
  readonly search: string;
  readonly setSearch: (value: string) => void;
  readonly objectiveFilter: string;
  readonly setObjectiveFilter: (value: string) => void;
  readonly objectives: NonNullable<LearningArea["objectives"]>;
  readonly legacyObjectives: readonly string[];
  readonly flaggedOnly: boolean;
  readonly setFlaggedOnly: (value: boolean) => void;
  readonly flaggedCardIds: readonly string[];
  readonly onFlag: ((id: string) => void) | undefined;
  readonly restoring: boolean;
  readonly onEdit: (card: Assessment) => void;
  readonly onOpenDuplicate:
    ((candidate: import("@recall/application").CardDuplicateCandidate) => void) | undefined;
};

export function KnowledgeAreaCardLibraryTools(props: KnowledgeAreaCardLibraryToolsProps) {
  const {
    area,
    workspace,
    fieldId,
    search,
    setSearch,
    objectiveFilter,
    setObjectiveFilter,
    objectives,
    legacyObjectives,
    flaggedOnly,
    setFlaggedOnly,
    flaggedCardIds,
    onFlag,
    restoring,
    onEdit,
    onOpenDuplicate,
  } = props;
  const [duplicateScope, setDuplicateScope] = useState<"area" | "workspace">("area");
  const [scanDuplicates, setScanDuplicates] = useState(false);
  const duplicatePairs = getKnowledgeAreaCardLibraryDuplicates(
    workspace,
    area,
    scanDuplicates,
    duplicateScope,
  );
  const flaggedCount = area.cards.filter((card) => flaggedCardIds.includes(card.id)).length;
  const toggleDuplicates = () => {
    setScanDuplicates((open) => !open);
  };
  const setDuplicateSearchScope = (value: string) => {
    setDuplicateScope(value === "workspace" ? "workspace" : "area");
  };
  return (
    <Collapsible className="mb-4" open={scanDuplicates} onOpenChange={setScanDuplicates}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <label htmlFor={`${fieldId}-search`} className="sr-only">
            Search cards
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={`${fieldId}-search`}
            type="search"
            className="w-full bg-transparent pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search questions, answers or tags…"
          />
        </div>
        <KnowledgeAreaCardLibraryObjectiveFilter
          fieldId={fieldId}
          objectives={objectives}
          legacyObjectives={legacyObjectives}
          value={objectiveFilter}
          onChange={(value) => {
            setObjectiveFilter(value === "all" ? "" : value);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ShadcnButton type="button" variant="outline" size="icon" aria-label="Card tools">
              <Ellipsis aria-hidden="true" />
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onFlag && (
              <DropdownMenuCheckboxItem checked={flaggedOnly} onCheckedChange={setFlaggedOnly}>
                Flagged cards ({flaggedCount})
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuItem onSelect={toggleDuplicates}>
              {scanDuplicates ? "Close duplicate finder" : "Find duplicates"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {flaggedOnly && (
        <p className="mt-3 text-sm text-muted-foreground">
          Showing flagged cards. Change this in Card tools.
        </p>
      )}
      <CollapsibleContent className="pt-4">
        <KnowledgeAreaCardLibraryDuplicateScopeSelect
          fieldId={fieldId}
          workspace={workspace}
          value={duplicateScope}
          onChange={setDuplicateSearchScope}
        />
        <KnowledgeAreaCardLibraryDuplicateResults
          pairs={duplicatePairs}
          area={area}
          scope={duplicateScope}
          scanning={scanDuplicates}
          restoring={restoring}
          onEdit={onEdit}
          onOpenDuplicate={onOpenDuplicate}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
