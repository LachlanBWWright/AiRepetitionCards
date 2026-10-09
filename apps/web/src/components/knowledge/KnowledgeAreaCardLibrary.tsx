"use client";

import {
  cardVersionHistory,
  cardVersionRestoresAsCopy,
  findDuplicateCardPairs,
  workspaceAuthoringBaseline,
  workspaceDuplicateCandidates,
  type CardDuplicateCandidate,
} from "@recall/application";
import type { CardVersion, LearningArea, Assessment, Workspace } from "@recall/domain";
import { useId, useMemo, useState } from "react";
import { ChevronDown, Ellipsis } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import { Button as ShadcnButton } from "@recall/ui-web/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { EmptyState } from "../ui/EmptyState";
import { CardVersionHistory } from "./CardVersionHistory";

type KnowledgeAreaCardLibraryProps = {
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
  onEdit,
  onDelete,
  onAdd,
  workspace,
  onRestoreVersion,
  restoring = false,
  showDeletedRecovery = true,
  onOpenDuplicate,
}: KnowledgeAreaCardLibraryProps) {
  const fieldId = useId();
  const [duplicateScope, setDuplicateScope] = useState<"area" | "workspace">("area");
  const [scanDuplicates, setScanDuplicates] = useState(false);
  const candidates = useMemo(
    () =>
      workspace
        ? workspaceDuplicateCandidates(workspace)
        : area.cards.map((card) => ({
            id: card.id,
            front: card.front,
            back: card.back,
            ...(card.cloze ? { cloze: card.cloze } : {}),
            areaId: area.id,
            areaTitle: area.title,
          })),
    [workspace, area],
  );
  const duplicatePairs = useMemo(
    () =>
      scanDuplicates
        ? findDuplicateCardPairs(
            duplicateScope === "area"
              ? candidates.filter((candidate) => candidate.areaId === area.id)
              : candidates,
          )
        : [],
    [scanDuplicates, candidates, area.id, duplicateScope],
  );
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
  const query = search.trim().toLocaleLowerCase();
  const filteredCards = area.cards.filter((card) => {
    const matchesQuery = [card.front, card.back, ...(card.tags ?? [])].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
    const matchesObjective =
      !objectiveFilter ||
      objectives.some(
        (objective) =>
          `id:${objective.id}` === objectiveFilter &&
          ((card.objectiveIds ?? []).includes(objective.id) || card.objective === objective.title),
      ) ||
      `title:${card.objective}` === objectiveFilter;
    return matchesQuery && matchesObjective;
  });

  return (
    <section aria-label="Card library" className="mt-0">
      {showDeletedRecovery && deletedVersions.length > 0 && (
        <Collapsible className="py-4">
          <CollapsibleTrigger asChild>
            <Button variant="secondary">Deleted cards ({deletedVersions.length})</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {deletedVersions.map((version) => (
              <div key={version.cardId}>
                <h3 className="text-base font-semibold">{version.card.front}</h3>
                <CardVersionHistory
                  versions={workspace ? cardVersionHistory(workspace, area.id, version.cardId) : []}
                  {...(onRestoreVersion ? { onRestore: onRestoreVersion } : {})}
                  baselineForVersion={baselineForVersion}
                  restoresAsCopy={
                    workspace
                      ? cardVersionRestoresAsCopy(workspace, version.areaId, version.cardId)
                      : false
                  }
                  disabled={restoring}
                />
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
      <Collapsible className="my-5" open={scanDuplicates} onOpenChange={setScanDuplicates}>
        <div className="flex flex-wrap items-end gap-3">
          <label
            htmlFor={`${fieldId}-search`}
            className="grid min-w-[220px] flex-1 basis-0 gap-2 text-sm"
          >
            Search cards
            <Input
              id={`${fieldId}-search`}
              type="search"
              className="w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Question, answer or tag"
            />
          </label>
          {(objectives.length > 0 || legacyObjectives.length > 0) && (
            <label
              htmlFor={`${fieldId}-objective`}
              className="grid min-w-[180px] flex-1 gap-2 text-sm"
            >
              Learning objective
              <Select
                value={objectiveFilter || "all"}
                onValueChange={(value) => setObjectiveFilter(value === "all" ? "" : value)}
              >
                <SelectTrigger id={`${fieldId}-objective`} aria-label="Learning objective">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All objectives</SelectItem>
                  {objectives.map((objective) => (
                    <SelectItem key={objective.id} value={`id:${objective.id}`}>
                      {objective.title}
                    </SelectItem>
                  ))}
                  {legacyObjectives.map((title) => (
                    <SelectItem key={title} value={`title:${title}`}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <CollapsibleTrigger asChild>
            <Button variant="secondary" aria-expanded={scanDuplicates}>
              Find duplicates
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-4">
          {workspace && (
            <label htmlFor={`${fieldId}-duplicate-scope`}>
              Look in{" "}
              <Select
                value={duplicateScope}
                onValueChange={(value) =>
                  setDuplicateScope(value === "workspace" ? "workspace" : "area")
                }
              >
                <SelectTrigger
                  id={`${fieldId}-duplicate-scope`}
                  aria-label="Duplicate search scope"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">This area</SelectItem>
                  <SelectItem value="workspace">All areas</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          {scanDuplicates &&
            (duplicatePairs.length === 0 ? (
              <p>No matches in this scan.</p>
            ) : (
              <ul className="my-6 list-none p-0">
                {duplicatePairs.map(({ left, right, reason }) => (
                  <li key={`${left.id}:${right.id}`} className="border-b py-4 last:border-b-0">
                    <p>{left.front}</p>
                    {duplicateScope === "workspace" && <p>{left.areaTitle}</p>}
                    <p>{right.front}</p>
                    {duplicateScope === "workspace" && <p>{right.areaTitle}</p>}
                    <p>{reason}</p>
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button size="small" variant="secondary">
                          Compare answers
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p>{left.back}</p>
                        <p>{right.back}</p>
                      </CollapsibleContent>
                    </Collapsible>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={restoring}
                      onClick={() => {
                        const card = area.cards.find((item) => item.id === left.id);
                        if (card) onEdit(card);
                        else onOpenDuplicate?.(left);
                      }}
                    >
                      Open first card
                    </Button>
                    {(onOpenDuplicate || right.areaId === area.id) && (
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={restoring}
                        onClick={() => {
                          const card = area.cards.find((item) => item.id === right.id);
                          if (card) onEdit(card);
                          else onOpenDuplicate?.(right);
                        }}
                      >
                        Open matching card
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
          {duplicatePairs.length >= 100 && <p>Showing the first 100 matches.</p>}
        </CollapsibleContent>
      </Collapsible>
      <p className="mb-2 text-right text-xs text-[var(--muted)]" role="status" aria-live="polite">
        Showing {filteredCards.length} of {area.cards.length} cards
      </p>
      {filteredCards.length > 0 ? (
        <div className="my-3 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[420px] border-collapse text-sm" aria-label="Cards">
            <thead className="border-b border-[var(--line)] bg-[var(--surface-hover)]/50 text-left text-xs font-medium text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3" scope="col">
                  Question
                </th>
                <th className="w-16 px-3 py-3 text-right" scope="col">
                  <ShadcnButton
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="size-8 rounded-md border-transparent bg-transparent shadow-none hover:bg-[var(--surface-hover)]"
                    aria-label="Add a card"
                    onClick={onAdd}
                  >
                    <span aria-hidden="true">+</span>
                  </ShadcnButton>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredCards.map((card) => (
                <tr key={card.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                  <th className="max-w-0 px-4 py-3 text-left font-medium" scope="row">
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="group flex w-full items-start justify-between gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                        >
                          <span
                            className="[overflow-wrap:anywhere]"
                            style={{ whiteSpace: "pre-wrap" }}
                          >
                            {card.front}
                          </span>
                          <ChevronDown
                            className="mt-0.5 size-4 shrink-0 text-[var(--muted)] transition-transform group-data-[state=open]:rotate-180"
                            aria-hidden="true"
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="grid gap-2 pt-3 font-normal text-[var(--muted)]">
                        <p
                          className="m-0"
                          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                        >
                          <span className="font-medium text-[var(--ink)]">Answer: </span>
                          {card.back}
                        </p>
                        <p className="m-0">
                          <span className="font-medium text-[var(--ink)]">Objective: </span>
                          {card.objective}
                        </p>
                        <p className="m-0">
                          <span className="font-medium text-[var(--ink)]">Next review: </span>
                          <time dateTime={card.schedule.due}>{card.schedule.due.slice(0, 10)}</time>
                        </p>
                        {(card.tags ?? []).length > 0 && (
                          <p className="m-0" aria-label="Tags">
                            <span className="font-medium text-[var(--ink)]">Tags: </span>
                            {card.tags?.join(", ")}
                          </p>
                        )}
                        {workspace && (
                          <CardVersionHistory
                            versions={cardVersionHistory(workspace, area.id, card.id)}
                            currentCard={card}
                            {...(onRestoreVersion ? { onRestore: onRestoreVersion } : {})}
                            baselineForVersion={baselineForVersion}
                            disabled={restoring}
                          />
                        )}
                      </CollapsibleContent>
                    </Collapsible>
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
                        <DropdownMenuItem onSelect={() => onEdit(card)}>Edit card</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>
                          Delete card
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setObjectiveFilter("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      )}
    </section>
  );
}
