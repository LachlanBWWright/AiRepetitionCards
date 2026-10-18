import { View } from "react-native";
import type { NativeWorkspaceAuthoringPanelProps } from "./NativeWorkspaceAuthoringPanel.types";
import { DeleteConfirmation } from "./workflows/DeleteConfirmation";
import { NativeWorkspaceCardEditor } from "./editor/NativeWorkspaceCardEditor";
import { NativeWorkspaceCardLibrary } from "./library/NativeWorkspaceCardLibrary";
import { NativeWorkspaceCreation } from "./NativeWorkspaceCreation";
import { NativeWorkspaceDeckControls } from "./library/NativeWorkspaceDeckControls";
import { NativeWorkspaceDeckPicker } from "./library/NativeWorkspaceDeckPicker";
import { NativeWorkspaceDrafts } from "./drafts/NativeWorkspaceDrafts";
import { NativeWorkspaceNotices } from "./NativeWorkspaceNotices";
import { NativeWorkspaceSearchHistory } from "./NativeWorkspaceSearchHistory";
import { NativeWorkspaceSettingsEditor } from "./settings/NativeWorkspaceSettingsEditor";
import { NativeWorkspaceSimpleEditors } from "./settings/NativeWorkspaceSimpleEditors";
import { useNativeWorkspaceAuthoringSections } from "./sections/useNativeWorkspaceAuthoringSections";

export type { NativeWorkspaceAuthoringPanelProps } from "./NativeWorkspaceAuthoringPanel.types";

export function NativeWorkspaceAuthoringPanel(props: NativeWorkspaceAuthoringPanelProps) {
  const sections = useNativeWorkspaceAuthoringSections(props);
  return (
    <View className="gap-[12px]" testID="native-workspace-authoring">
      <NativeWorkspaceDrafts {...sections.overview.drafts} />
      {!props.hideAreaPicker && <NativeWorkspaceDeckPicker {...sections.overview.deckPicker} />}
      <NativeWorkspaceNotices {...sections.overview.notices} />
      <NativeWorkspaceCreation {...sections.overview.creation} />
      <NativeWorkspaceSearchHistory {...sections.searchHistory} />
      {sections.deckControls && <NativeWorkspaceDeckControls {...sections.deckControls} />}
      <NativeWorkspaceSimpleEditors {...sections.simpleEditors} />
      {sections.cardEditor && <NativeWorkspaceCardEditor {...sections.cardEditor} />}
      {sections.settingsEditor && <NativeWorkspaceSettingsEditor {...sections.settingsEditor} />}
      <DeleteConfirmation {...sections.deleteConfirmation} />
      <NativeWorkspaceCardLibrary {...sections.cardLibrary} />
    </View>
  );
}
