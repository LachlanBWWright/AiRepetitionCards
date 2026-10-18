import {
  parseTagInput,
  workspaceAuthoringBaseline,
  type WorkspaceAuthoringCommand,
} from "@recall/application";
import { WorkspaceAuthoringCommandSchema } from "@recall/application";
import type { LearningArea, Workspace } from "@recall/domain";
import { Effect, Either, Schema } from "effect";
import { useRef, useState } from "react";

type BulkSave = (
  command: WorkspaceAuthoringCommand,
  baseline: string | undefined,
) => Promise<{ readonly ok: boolean; readonly message?: string }>;

type KnowledgeAreaCardLibraryBulkActions = {
  readonly area: LearningArea;
  readonly workspace: Workspace | undefined;
  readonly onBulk: BulkSave | undefined;
};

export function useKnowledgeAreaCardLibraryBulkActions({
  area,
  workspace,
  onBulk,
}: KnowledgeAreaCardLibraryBulkActions) {
  const [selected, setSelected] = useState<readonly string[]>([]);
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
  return {
    setSelected,
    selectedIds,
    bulkAction,
    setBulkAction,
    bulkTags,
    setBulkTags,
    destination,
    setDestination,
    bulkPending,
    bulkError,
    bulkRequest,
    setBulkRequest,
    beginBulk,
    submitBulk,
  };
}
