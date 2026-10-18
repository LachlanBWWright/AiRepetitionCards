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
