"use client";

import {
  cardVersionHistory,
  cardVersionRestoresAsCopy,
  findDuplicateCardPairs,
  workspaceAuthoringBaseline,
  workspaceDuplicateCandidates,
  type CardDuplicateCandidate,
  type WorkspaceAuthoringCommand,
  parseTagInput,
} from "@recall/application";
import type { CardVersion, LearningArea, Assessment, Workspace } from "@recall/domain";
import { WorkspaceAuthoringCommandSchema } from "@recall/application";
import { Effect, Either, Schema } from "effect";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@recall/ui-web/components/dialog";
import { useId, useMemo, useRef, useState } from "react";
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
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [localFlaggedOnly, setLocalFlaggedOnly] = useState(false);
  const flaggedOnly = requestedFlaggedOnly ?? localFlaggedOnly;
  const setFlaggedOnly = (value: boolean) => {
    setLocalFlaggedOnly(value);
    onFlaggedFilterChange?.(value);
  };
  const [bulkAction, setBulkAction] = useState<"tags" | "move" | "delete" | null>(null);
  const [bulkTags, setBulkTags] = useState("");
  const [destination, setDestination] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkGuard = useRef(false);
  const bulkSnapshot = useRef(workspace);
  const selectedIds = selected.filter((id) => area.cards.some((card) => card.id === id));
  const [bulkRequest, setBulkRequest] = useState<{
    readonly command: WorkspaceAuthoringCommand;
    readonly baseline: string | undefined;
  } | null>(null);
  function beginBulk(action: "tags" | "move" | "delete") {
    bulkSnapshot.current = workspace;
    setBulkError(null);
    setBulkRequest(null);
    setBulkAction(action);
    if (action === "delete" && workspace) {
      const command: WorkspaceAuthoringCommand = {
        kind: "bulk-delete-cards",
        areaId: area.id,
        cardIds: area.cards.filter((card) => selectedIds.includes(card.id)).map((card) => card.id),
      };
      setBulkRequest({
        command,
        baseline: workspaceAuthoringBaseline(bulkSnapshot.current ?? workspace, command),
      });
    }
  }
  async function submitBulk() {
    if (!workspace || !onBulk || bulkGuard.current) return;
    let request = bulkRequest;
    if (!request) {
      const cards = area.cards.filter((card) => selectedIds.includes(card.id));
      if (bulkAction === "tags") {
        const tags = parseTagInput(bulkTags);
        if (Either.isLeft(tags) || (Either.isRight(tags) && tags.right.length === 0)) {
          setBulkError(Either.isLeft(tags) ? tags.left.message : "Enter at least one tag.");
          return;
        }
        const command: WorkspaceAuthoringCommand = {
          kind: "bulk-tag-cards",
          areaId: area.id,
          cardIds: cards.map((card) => card.id),
          tags: tags.right,
        };
        request = {
          command,
          baseline: workspaceAuthoringBaseline(bulkSnapshot.current ?? workspace, command),
        };
      } else if (bulkAction === "move") {
        const target = workspace.areas.find((item) => item.id === destination);
        if (!target || target.id === area.id) {
          setBulkError("Choose a different destination deck.");
          return;
        }
        const ids = Effect.runSync(
          Effect.either(
            Effect.try({
              try: () => cards.map((card) => ({ cardId: card.id, newCardId: crypto.randomUUID() })),
              catch: () => ({ message: "Card identifiers could not be created. Try again." }),
            }),
          ),
        );
        if (Either.isLeft(ids)) {
          setBulkError(ids.left.message);
          return;
        }
        const commandInput: unknown = {
          kind: "bulk-move-cards",
          areaId: area.id,
          targetAreaId: target.id,
          cards: ids.right,
        };
        const command = Effect.runSync(
          Effect.either(Schema.decodeUnknown(WorkspaceAuthoringCommandSchema)(commandInput)),
        );
        if (Either.isLeft(command)) {
          setBulkError("This move could not be validated.");
          return;
        }
        request = {
          command: command.right,
          baseline: workspaceAuthoringBaseline(bulkSnapshot.current ?? workspace, command.right),
        };
      }
    }
    if (!request) return;
    setBulkRequest(request);
    bulkGuard.current = true;
    setBulkPending(true);
    const outcome = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => onBulk(request.command, request.baseline),
          catch: () => ({ message: "The selection wasn’t saved. It is still available; retry." }),
        }),
      ),
    );
    bulkGuard.current = false;
    setBulkPending(false);
    if (Either.isLeft(outcome) || !outcome.right.ok) {
      setBulkError(
        Either.isLeft(outcome)
          ? outcome.left.message
          : (outcome.right.message ??
              "Save not confirmed. The selection is still here. Retry saving or cancel to review it."),
      );
      return;
    }
    setSelected([]);
    setBulkAction(null);
    setBulkRequest(null);
  }
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
    return matchesQuery && matchesObjective && (!flaggedOnly || flaggedCardIds.includes(card.id));
  });

  return (
    <section aria-label="Card library" className="mt-0">
      {onFlag && (
        <Button
          variant="secondary"
          onClick={() => setFlaggedOnly(!flaggedOnly)}
          aria-pressed={flaggedOnly}
        >
          {flaggedOnly
            ? "Show all cards"
            : `Flagged for editing (${area.cards.filter((card) => flaggedCardIds.includes(card.id)).length})`}
        </Button>
      )}
      {onBulk && (
        <div className="my-3 flex flex-wrap items-center gap-2" aria-label="Bulk card actions">
          <Button
            variant="secondary"
            disabled={restoring || bulkPending || filteredCards.length === 0}
            onClick={() =>
              setSelected([...new Set([...selectedIds, ...filteredCards.map((card) => card.id)])])
            }
          >
            Select visible cards
          </Button>
          <span className="text-sm" role="status">
            {selectedIds.length} selected
          </span>
          {selectedIds.length > 0 && (
            <>
              <Button
                variant="secondary"
                disabled={restoring || bulkPending}
                onClick={() => beginBulk("tags")}
              >
                Add tags
              </Button>
              <Button
                variant="secondary"
                disabled={restoring || bulkPending || (workspace?.areas.length ?? 0) < 2}
                onClick={() => beginBulk("move")}
              >
                Move cards
              </Button>
              <Button
                variant="secondary"
                disabled={restoring || bulkPending}
                onClick={() => beginBulk("delete")}
              >
                Delete selected
              </Button>
              <Button variant="secondary" disabled={bulkPending} onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </>
          )}
        </div>
      )}
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulkPending) {
            setBulkAction(null);
            setBulkRequest(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "tags"
                ? "Add tags"
                : bulkAction === "move"
                  ? "Move selected cards"
                  : "Delete selected cards"}
            </DialogTitle>
            <DialogDescription>
              {selectedIds.length} selected cards.{" "}
              {bulkAction === "move"
                ? "Cards receive fresh schedules in the destination. Original reviews stay in Deleted cards; matching objectives are linked by title. Attachments and tags are retained."
                : bulkAction === "delete"
                  ? "Review history is preserved. Recover these cards from Deleted cards."
                  : "New tags are added without changing schedules or review history."}
            </DialogDescription>
          </DialogHeader>
          {bulkAction === "tags" && (
            <label>
              Tags (comma separated)
              <Input
                value={bulkTags}
                disabled={bulkPending || Boolean(bulkRequest)}
                onChange={(event) => setBulkTags(event.target.value)}
              />
            </label>
          )}
          {bulkAction === "move" && (
            <label>
              Destination deck
              <Select
                value={destination}
                onValueChange={setDestination}
                disabled={bulkPending || Boolean(bulkRequest)}
              >
                <SelectTrigger aria-label="Destination deck">
                  <SelectValue placeholder="Choose a deck" />
                </SelectTrigger>
                <SelectContent>
                  {workspace?.areas
                    .filter((item) => item.id !== area.id)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {bulkError && (
            <p role="alert" className="text-sm text-destructive">
              {bulkError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={bulkPending}
              onClick={() => {
                setBulkAction(null);
                setBulkRequest(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={bulkPending || restoring || selectedIds.length === 0}
              onClick={() => void submitBulk()}
            >
              {bulkPending
                ? "Saving selection…"
                : bulkRequest && bulkError
                  ? "Retry selection"
                  : bulkAction === "delete"
                    ? "Confirm deletion"
                    : bulkAction === "move"
                      ? "Confirm move"
                      : "Save tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                {onBulk && (
                  <th scope="col" className="w-12 px-3 py-3">
                    Select
                  </th>
                )}
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
                  {onBulk && (
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selectedIds.includes(card.id)}
                        disabled={restoring || bulkPending}
                        aria-label={`Select card: ${card.front}`}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked === true
                              ? [...new Set([...current, card.id])]
                              : current.filter((id) => id !== card.id),
                          )
                        }
                      />
                    </td>
                  )}
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
                            {flaggedCardIds.includes(card.id) && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Flagged for editing
                              </span>
                            )}
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
                        {onFlag && (
                          <DropdownMenuItem onSelect={() => onFlag(card.id)}>
                            {flaggedCardIds.includes(card.id)
                              ? "Remove editing flag"
                              : "Improve later"}
                          </DropdownMenuItem>
                        )}
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
                  setFlaggedOnly(false);
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
