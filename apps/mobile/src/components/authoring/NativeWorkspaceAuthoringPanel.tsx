import { NativeNoteAuthoringSection } from "./notes/NativeNoteAuthoringSection";
import { Text, View } from "react-native";
import { useState } from "react";
import { NativeButton } from "@recall/ui-native";
import { NativeCardBrowser } from "../review/NativeCardBrowser";
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
  const [browsing, setBrowsing] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const editing = Boolean(sections.simpleEditors.editor);
  const area = props.workspace?.areas.find((item) => item.id === props.activeAreaId);
  const editingArea = props.workspace?.areas.find(
    (item) => item.id === sections.cardEditor?.editor.areaId,
  );
  return (
    <View className="gap-[12px]" testID="native-workspace-authoring">
      <NativeWorkspaceDrafts
        {...sections.overview.drafts}
        drafts={editing ? [] : sections.overview.drafts.drafts}
      />
      {editing && (
        <Text className="text-recall-muted text-sm">
          {editingArea?.title ?? area?.title ?? "Your workspace"}
        </Text>
      )}
      {!editing && area && (
        <NativeButton
          variant="secondary"
          label={browsing ? "Back to cards" : "Browse cards"}
          onPress={() => {
            setBrowsing(!browsing);
          }}
        />
      )}
      {props.workspace && area && browsing && (
        <View className={editing ? "hidden" : "gap-3"}>
          <NativeCardBrowser
            workspace={props.workspace}
            area={area}
            now={props.now ?? openedAt}
            save={props.onCommand}
            onEdit={sections.editBrowsedCard}
          />
        </View>
      )}
      <View className={editing || browsing ? "hidden" : "gap-3"}>
        {!props.hideAreaPicker && <NativeWorkspaceDeckPicker {...sections.overview.deckPicker} />}
        <NativeWorkspaceCreation {...sections.overview.creation} />
        <NativeWorkspaceSearchHistory {...sections.searchHistory} />
        {sections.deckControls && <NativeWorkspaceDeckControls {...sections.deckControls} />}
      </View>
      <NativeWorkspaceNotices {...sections.overview.notices} />
      <NativeWorkspaceSimpleEditors {...sections.simpleEditors} />
      <View
        className={
          (browsing && !editing) || (editing && !sections.cardEditor?.editor.sourceCard?.noteId)
            ? "hidden"
            : "gap-3"
        }
      >
        <NativeNoteAuthoringSection
          {...props}
          activeAreaId={sections.cardEditor?.editor.areaId ?? props.activeAreaId}
          initialNoteId={sections.cardEditor?.editor.sourceCard?.noteId}
        />
      </View>
      {sections.cardEditor && !sections.cardEditor.editor.sourceCard?.noteId && (
        <NativeWorkspaceCardEditor {...sections.cardEditor} />
      )}
      {sections.settingsEditor && <NativeWorkspaceSettingsEditor {...sections.settingsEditor} />}
      <DeleteConfirmation {...sections.deleteConfirmation} />
      <View className={editing || browsing ? "hidden" : "gap-3"}>
        <NativeWorkspaceCardLibrary {...sections.cardLibrary} />
      </View>
    </View>
  );
}
