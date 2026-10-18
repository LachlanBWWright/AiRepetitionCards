import { type Workspace } from "@recall/domain";
import { cardVersionRestoresAsCopy } from "../card-history";
import type { WorkspaceAuthoringCommand } from "./workspace-authoring";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonical(item));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function authoredCard(card: Workspace["areas"][number]["cards"][number]): unknown {
  return Object.fromEntries(Object.entries(card).filter(([key]) => key !== "schedule"));
}
/** Content baseline deliberately excludes derived scheduling and append-only review changes. */
export function workspaceAuthoringBaseline(
  workspace: Workspace,
  command: WorkspaceAuthoringCommand,
): string | undefined {
  if (command.kind === "update-scheduler-settings")
    return JSON.stringify(canonical(workspace.schedulerSettings ?? { requestRetention: 0.9 }));
  if (
    command.kind === "create-card" ||
    command.kind === "create-cards" ||
    (command.kind === "save-area" && command.mode === "create")
  )
    return undefined;
  const areaId = command.kind === "save-area" ? command.id : command.areaId;
  const area = workspace.areas.find((item) => item.id === areaId);
  if (
    command.kind === "bulk-tag-cards" ||
    command.kind === "bulk-delete-cards" ||
    command.kind === "bulk-move-cards"
  ) {
    const ids =
      command.kind === "bulk-move-cards"
        ? command.cards.map((card) => card.cardId)
        : command.cardIds;
    const target =
      command.kind === "bulk-move-cards"
        ? workspace.areas.find((item) => item.id === command.targetAreaId)
        : undefined;
    return JSON.stringify(
      canonical({
        owner: workspace.syncOwnerId ?? null,
        area: area ? { id: area.id, objectives: area.objectives ?? [] } : null,
        cards: [...new Set(ids)].sort().map((id) => {
          const card = area?.cards.find((item) => item.id === id);
          return card ? authoredCard(card) : null;
        }),
        target: target ? { id: target.id, objectives: target.objectives ?? [] } : null,
      }),
    );
  }
  if (command.kind === "restore-card") {
    const card = area?.cards.find((card) => card.id === command.cardId);
    return JSON.stringify(
      canonical({
        syncOwnerId: workspace.syncOwnerId ?? null,
        restoresAsCopy: cardVersionRestoresAsCopy(workspace, command.areaId, command.cardId),
        card: card ? authoredCard(card) : null,
        area: area ? { ...area, cards: undefined } : null,
        version:
          workspace.cardVersions?.find((version) => version.id === command.versionId) ?? null,
        deletedCards: workspace.deletedCards ?? [],
        deletedAreas: workspace.deletedAreas ?? [],
      }),
    );
  }
  if (!area) return JSON.stringify(null);
  if (
    command.kind === "update-card" ||
    command.kind === "delete-card" ||
    command.kind === "replace-card"
  ) {
    const card = area.cards.find((item) => item.id === command.cardId);
    return JSON.stringify(
      canonical({ card: card ? authoredCard(card) : null, objectives: area.objectives ?? [] }),
    );
  }
  return JSON.stringify(canonical({ ...area, cards: area.cards.map(authoredCard) }));
}
