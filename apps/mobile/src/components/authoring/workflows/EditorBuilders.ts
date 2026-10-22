import {
  formatTagInput,
  workspaceAuthoringBaseline,
  WorkspaceAuthoringCommandSchema,
} from "@recall/application";
import { Either, Schema } from "effect";
import type { LearningArea, Workspace } from "@recall/domain";
import {
  emptyContent,
  settingsFor,
  type Editor,
  type NativeWorkspaceAuthoringPanelProps,
} from "../NativeWorkspaceAuthoringPanel.types";

export type EditorBuilderContext = {
  readonly workspace: Workspace | null;
  readonly area: LearningArea | undefined;
  readonly createId: () => string;
};

export function createEditorBuilders({ workspace, area, createId }: EditorBuilderContext) {
  const bound = (command: unknown) => {
    if (!workspace) return {};
    const decoded = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
    if (Either.isLeft(decoded)) return {};
    const baseline = workspaceAuthoringBaseline(workspace, decoded.right);
    return baseline === undefined ? {} : { baseline };
  };

  const areaEditor = (mode: "create" | "edit"): Editor => ({
    kind: "area",
    mode,
    id: mode === "edit" && area ? area.id : createId(),
    title: mode === "edit" ? (area?.title ?? "") : "",
    color: mode === "edit" ? (area?.color ?? "#3b82f6") : "#3b82f6",
    ...(mode === "edit" && area
      ? bound({ kind: "save-area", mode, id: area.id, title: area.title, color: area.color })
      : {}),
  });

  const cardEditor = (index?: number, kind: "basic" | "cloze" = "basic"): Editor | null => {
    if (!area) return null;
    const card = index === undefined ? undefined : area.cards[index];
    return {
      kind: "card",
      mode: card ? "edit" : "create",
      areaId: area.id,
      id: card?.id ?? createId(),
      tagsText: formatTagInput(card?.tags ?? []),
      stagedAssets: [],
      ...(card ? { sourceCard: card } : {}),
      content: card
        ? {
            kind: card.cloze ? "cloze" : "basic",
            front: card.front,
            back: card.back,
            ...(card.imageOcclusion ? { imageOcclusion: card.imageOcclusion } : {}),
            ...(card.cloze ? { cloze: card.cloze } : {}),
            objectiveIds: card.objectiveIds ?? [],
            tags: card.tags ?? [],
            media: card.media ?? [],
            presentation: card.presentation,
          }
        : {
            ...emptyContent,
            kind,
            ...(kind === "cloze" ? { cloze: { text: "", deletionIndex: 1 } } : {}),
          },
      ...(card ? bound({ kind: "delete-card", areaId: area.id, cardId: card.id }) : {}),
    };
  };

  const deleteEditor = (cardId?: string): Editor | null => {
    if (!area) return null;
    const command = cardId
      ? { kind: "delete-card", areaId: area.id, cardId }
      : { kind: "delete-area", areaId: area.id };
    return {
      kind: "delete",
      command,
      title: cardId
        ? `Delete card: ${area.cards.find((card) => card.id === cardId)?.front.slice(0, 150) ?? "this card"}?`
        : `Delete ${area.title}?`,
      ...bound(command),
    };
  };

  const schedulerEditor = (): Editor => {
    const settings = workspace?.schedulerSettings ?? { requestRetention: 0.9 };
    return {
      kind: "scheduler",
      retentionPercent: String(settings.requestRetention * 100),
      settings,
      dailyNewLimit: String(settings.dailyNewLimit ?? 20),
      leechThreshold: String(settings.leechThreshold ?? 8),
      ...bound({ kind: "update-scheduler-settings", settings }),
    };
  };

  const settingsEditor = (): Editor | null =>
    area
      ? {
          kind: "settings",
          areaId: area.id,
          settings: settingsFor(area),
          tagsText: formatTagInput(area.tags ?? []),
          ...bound({ kind: "delete-area", areaId: area.id }),
        }
      : null;

  function initialEditor(
    initial: NativeWorkspaceAuthoringPanelProps["initialEditor"],
  ): Editor | null {
    if (initial === "scheduler") return schedulerEditor();
    if (initial === "create-area") return areaEditor("create");
    if (initial === "edit-area") return areaEditor("edit");
    if (initial === "edit-card") return cardEditor(0);
    if (initial === "basic" || initial === "cloze") return cardEditor(undefined, initial);
    if (initial === "settings") return settingsEditor();
    if (initial === "delete-area") return deleteEditor();
    if (initial === "delete-card") return deleteEditor(area?.cards[0]?.id) ?? null;
    return null;
  }

  return {
    areaEditor,
    cardEditor,
    deleteEditor,
    schedulerEditor,
    settingsEditor,
    bound,
    initialEditor,
  };
}
