"use client";

import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import { useRef, useState } from "react";
import { getKnowledgeAreaCardLibraryDuplicates } from "./KnowledgeAreaCardLibraryDerivations";
import { Ellipsis, Search } from "lucide-react";
import { KnowledgeAreaCardLibraryDuplicateResults } from "./duplicates/KnowledgeAreaCardLibraryDuplicateResults";
import { KnowledgeAreaCardLibraryObjectiveFilter } from "./KnowledgeAreaCardLibraryObjectiveFilter";
import { KnowledgeAreaCardLibraryDuplicateScopeSelect } from "./duplicates/KnowledgeAreaCardLibraryDuplicateScope";
import { Input, FieldLabel } from "@recall/ui-web";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
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
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const hasObjectives = objectives.length > 0 || legacyObjectives.length > 0;
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
    setScanDuplicates(true);
  };
  const setDuplicateSearchScope = (value: string) => {
    setDuplicateScope(value === "workspace" ? "workspace" : "area");
  };
  const flaggedFilter = onFlag ? (
    <DropdownMenuCheckboxItem checked={flaggedOnly} onCheckedChange={setFlaggedOnly}>
      Flagged cards ({flaggedCount})
    </DropdownMenuCheckboxItem>
  ) : null;
  return (
    <Dialog open={scanDuplicates} onOpenChange={setScanDuplicates}>
      <div className="flex flex-col gap-2">
        <div
          className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ${hasObjectives ? "lg:grid-cols-[minmax(0,1fr)_13rem_auto]" : ""}`}
        >
          <div className={`relative min-w-0 ${hasObjectives ? "col-span-2 lg:col-span-1" : ""}`}>
            <FieldLabel htmlFor={`${fieldId}-search`} className="sr-only">
              Search cards
            </FieldLabel>
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
              <ShadcnButton
                ref={toolsTrigger}
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Card tools"
              >
                <Ellipsis aria-hidden="true" />
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {flaggedFilter}
              <DropdownMenuItem onSelect={toggleDuplicates}>Find duplicates</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {flaggedOnly && (
          <p className="text-sm text-muted-foreground">
            Showing flagged cards. Change this in Card tools.
          </p>
        )}
      </div>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          toolsTrigger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Find duplicate cards</DialogTitle>
          <DialogDescription>
            Compare similar cards before choosing which to keep.
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
