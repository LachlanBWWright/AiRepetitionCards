import { Effect, Schema } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import { stableSyncId } from "@recall/sync-core";
import type { WorkspaceAuthoringCommand } from "../../authoring/workspace-authoring-command";
import type { WorkspaceAuthoringFailure } from "../../authoring/workspace-authoring-validation";
import { AgentProposalSchema, type AgentFailure } from "./contracts";
import { agentDeckRevision } from "./handover";

type AgentCommand = Extract<
  WorkspaceAuthoringCommand,
  {
    readonly kind: "save-area" | "delete-area" | "create-card" | "update-card" | "delete-card";
  }
>;
export type AgentChangePreview = {
  readonly title: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly destructive: boolean;
};
const fail = (message: string) => Effect.fail({ message });

/** Validate the complete batch before any persistence. IDs for new content are app-derived. */
export function planAgentChanges(workspace: Workspace, proposalInput: unknown) {
  return Effect.gen(function* () {
    const proposal = yield* Schema.decodeUnknown(AgentProposalSchema)(proposalInput, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError(() => ({ message: "Invalid external-agent change proposal." })));
    const scope = new Set(proposal.decks.map((deck) => deck.id));
    if (scope.size !== proposal.decks.length) return yield* fail("Duplicate deck baselines.");
    for (const base of proposal.decks) {
      const area = workspace.areas.find((item) => item.id === base.id);
      if (!area || agentDeckRevision(area) !== base.revision)
        return yield* fail(
          "A deck changed since this handover. Export fresh context and ask the agent to prepare a new proposal.",
        );
    }
    const created = new Map<string, ReturnType<typeof createAreaId>>();
    const usedKeys = new Set<string>();
    const touched = new Set<string>();
    const deletedDecks = new Set<string>();
    const commands: AgentCommand[] = [];
    const preview: AgentChangePreview[] = [];
    for (const operation of proposal.operations) {
      if ("key" in operation) {
        if (usedKeys.has(operation.key) || scope.has(operation.key))
          return yield* fail(
            "New content keys must be unique and distinct from existing deck IDs.",
          );
        usedKeys.add(operation.key);
      }
      if (operation.op === "create-deck") {
        const id = createAreaId(stableSyncId(`agent-deck:${proposal.handoverId}:${operation.key}`));
        if (workspace.areas.some((area) => area.id === id))
          return yield* fail("This proposal's new deck has already been applied.");
        created.set(operation.key, id);
        commands.push({
          kind: "save-area",
          mode: "create",
          id,
          title: operation.title,
          color: operation.color,
        });
        preview.push({
          title: "Create deck",
          before: null,
          after: operation.title,
          destructive: false,
        });
        continue;
      }
      const area = workspace.areas.find((item) => item.id === operation.deckId);
      const areaId = created.get(operation.deckId) ?? area?.id;
      if (
        !areaId ||
        (!scope.has(operation.deckId) && !created.has(operation.deckId)) ||
        deletedDecks.has(operation.deckId)
      )
        return yield* fail(
          "An operation targets a deck outside the handover or after its deletion.",
        );
      if (operation.op === "update-deck" || operation.op === "delete-deck") {
        if (!area) return yield* fail("Only exported existing decks can be updated or deleted.");
        const target = `deck:${area.id}`;
        if (
          touched.has(target) ||
          (operation.op === "delete-deck" &&
            proposal.operations.some(
              (item) => "deckId" in item && item.deckId === area.id && item.op !== "delete-deck",
            ))
        )
          return yield* fail(
            "Do not combine deck deletion with edits to that deck, or edit a deck twice.",
          );
        touched.add(target);
        if (operation.op === "delete-deck") {
          deletedDecks.add(area.id);
          commands.push({ kind: "delete-area", areaId });
          preview.push({
            title: `Delete deck: ${area.title} (${String(area.cards.length)} cards)`,
            before: JSON.stringify(
              { title: area.title, cards: area.cards.map(({ front, back }) => ({ front, back })) },
              null,
              2,
            ),
            after: null,
            destructive: true,
          });
        } else {
          commands.push({
            kind: "save-area",
            mode: "edit",
            id: areaId,
            title: operation.title,
            color: operation.color,
          });
          preview.push({
            title: "Update deck",
            before: `${area.title} ${area.color}`,
            after: `${operation.title} ${operation.color}`,
            destructive: false,
          });
        }
        continue;
      }
      const card =
        "cardId" in operation
          ? area?.cards.find((item) => item.id === operation.cardId)
          : undefined;
      if ("cardId" in operation) {
        const target = `card:${operation.cardId}`;
        if (!card || touched.has(target))
          return yield* fail("A card is missing or appears in more than one edit.");
        touched.add(target);
      }
      if (operation.op === "delete-card") {
        if (!card) return yield* fail("The card to delete no longer exists.");
        commands.push({ kind: "delete-card", areaId, cardId: card.id });
        preview.push({
          title: "Delete card",
          before: JSON.stringify({ front: card.front, back: card.back }, null, 2),
          after: null,
          destructive: true,
        });
        continue;
      }
      if (card && (card.cloze || card.noteId || card.imageOcclusion))
        return yield* fail(
          "Edit cloze, note-linked and image-occlusion cards with Recall's card editor. External proposals support basic text-card edits.",
        );
      const content = {
        kind: "basic" as const,
        front: operation.front,
        back: operation.back,
        explanation: operation.explanation,
        tags: operation.tags,
        objectiveIds: card?.objectiveIds ?? [],
        media: card?.media ?? [],
        ...(card?.presentation ? { presentation: card.presentation } : {}),
      };
      const cardId =
        card?.id ??
        createAssessmentId(
          stableSyncId(
            `agent-card:${proposal.handoverId}:${operation.op === "create-card" ? operation.key : operation.cardId}`,
          ),
        );
      commands.push({
        kind: operation.op === "create-card" ? "create-card" : "update-card",
        areaId,
        cardId,
        content,
      });
      const fields = ({
        front,
        back,
        explanation,
        tags,
      }: {
        readonly front: string;
        readonly back: string;
        readonly explanation?: string | undefined;
        readonly tags?: readonly string[] | undefined;
      }) =>
        JSON.stringify({ front, back, explanation: explanation ?? "", tags: tags ?? [] }, null, 2);
      preview.push({
        title: `${card ? "Update" : "Create"} card in ${area?.title ?? operation.deckId}`,
        before: card ? fields(card) : null,
        after: fields(content),
        destructive: false,
      });
    }
    return { proposal, commands, preview };
  });
}

function retainCardObjectives(
  previous: Workspace,
  updated: Workspace,
  command: AgentCommand,
): Workspace {
  if (command.kind !== "update-card") return updated;
  const original = previous.areas
    .find((area) => area.id === command.areaId)
    ?.cards.find((card) => card.id === command.cardId);
  if (!original) return updated;
  const areas = updated.areas.map((area) => {
    if (area.id !== command.areaId) return area;
    const cards = area.cards.map((card) =>
      card.id !== command.cardId
        ? card
        : {
            ...card,
            objective: original.objective,
            objectiveIds: original.objectiveIds,
          },
    );
    return { ...area, cards };
  });
  return { ...updated, areas };
}

export function applyAgentChanges(
  workspace: Workspace,
  proposal: unknown,
  now: Date,
  apply: (
    workspace: Workspace,
    command: AgentCommand,
    now: Date,
  ) => Effect.Effect<{ readonly workspace: Workspace }, WorkspaceAuthoringFailure>,
): Effect.Effect<
  { readonly workspace: Workspace; readonly message: string },
  WorkspaceAuthoringFailure
> {
  const classify = (error: AgentFailure): WorkspaceAuthoringFailure => ({
    _tag: "WorkspaceAuthoringFailure",
    reason: "stale-content",
    message: error.message,
  });
  return Effect.gen(function* () {
    const planned = yield* planAgentChanges(workspace, proposal).pipe(Effect.mapError(classify));
    let next = workspace;
    for (const command of planned.commands) {
      const applied = yield* apply(next, command, now);
      next = retainCardObjectives(next, applied.workspace, command);
    }
    return {
      workspace: next,
      message: "Approved agent changes saved. Review history is preserved.",
    };
  });
}
