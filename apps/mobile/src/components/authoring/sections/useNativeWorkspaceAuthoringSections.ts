import { useNativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
import type { NativeWorkspaceAuthoringPanelProps } from "../NativeWorkspaceAuthoringPanel.types";
import { createAuthoringOverview } from "./createAuthoringOverview";
import { createSearchHistorySection } from "./createSearchHistorySection";
import { createDeckControlsSection } from "./createDeckControlsSection";
import { createSimpleEditorsSection } from "./createSimpleEditorsSection";
import { createCardEditorSection } from "./createCardEditorSection";
import { createSettingsEditorSection } from "./createSettingsEditorSection";
import { createDeleteConfirmationSection } from "./createDeleteConfirmationSection";
import { createCardLibrarySection } from "./createCardLibrarySection";
export function useNativeWorkspaceAuthoringSections(props: NativeWorkspaceAuthoringPanelProps) {
  const controller = useNativeWorkspaceAuthoringController(props);
  return {
    editBrowsedCard: (
      area: import("@recall/domain").LearningArea,
      card: import("@recall/domain").Assessment,
    ) => {
      const index = area.cards.findIndex((item) => item.id === card.id);
      if (index >= 0) controller.open(controller.cardEditor(index, "basic", area));
    },
    overview: createAuthoringOverview(controller),
    searchHistory: createSearchHistorySection(controller),
    deckControls: createDeckControlsSection(controller),
    simpleEditors: createSimpleEditorsSection(controller),
    cardEditor: createCardEditorSection(controller),
    settingsEditor: createSettingsEditorSection(controller),
    deleteConfirmation: createDeleteConfirmationSection(controller),
    cardLibrary: createCardLibrarySection(controller),
  };
}
