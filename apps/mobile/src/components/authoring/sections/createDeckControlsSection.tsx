import { formatTagInput } from "@recall/application";
import { settingsFor } from "../NativeWorkspaceAuthoringPanel.types";
import { NativeWorkspaceDeckControls } from "../library/NativeWorkspaceDeckControls";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createDeckControlsSection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "workspace"
    | "area"
    | "now"
    | "locked"
    | "onStudy"
    | "onGenerateCards"
    | "areaEditor"
    | "cardEditor"
    | "open"
    | "areaMenu"
    | "setAreaMenu"
    | "schedulerEditor"
    | "deleteEditor"
    | "bound"
  >,
) {
  const {
    workspace,
    area,
    now,
    locked,
    onStudy,
    onGenerateCards,
    areaEditor,
    cardEditor,
    open,
    areaMenu,
    setAreaMenu,
    schedulerEditor,
    deleteEditor,
    bound,
  } = input;
  if (!area) return null;
  const props: ComponentProps<typeof NativeWorkspaceDeckControls> = {
    area,
    areaMenu,
    setAreaMenu,
    locked,
    hasWorkspace: Boolean(workspace),
    now,
    onRename: () => {
      open(areaEditor("edit"));
    },
    onSettings: () => {
      open({
        kind: "settings",
        areaId: area.id,
        settings: settingsFor(area),
        tagsText: formatTagInput(area.tags ?? []),
        ...bound({ kind: "delete-area", areaId: area.id }),
      });
    },
    onScheduler: () => {
      open(schedulerEditor());
    },
    onDelete: () => {
      open(deleteEditor());
    },
    onAddCard: () => {
      open(cardEditor());
    },
    onGenerateCards,
    onStudy,
  };
  return props;
}
