import type { MediaTrashPurgeResult } from "@recall/application";
import { Alert, Text, View } from "react-native";
import { useState } from "react";
import { NativeSelect } from "@recall/ui-native";
import { useWorkspaceRecovery, type StudyCommandSave } from "@recall/react";
import type { Workspace, MediaReference } from "@recall/domain";
import type { WorkspaceStore } from "@recall/local-store";
import { NativeButton } from "../ui/NativeButton";
export function NativeCollectionRecovery({
  workspace,
  store,
  save,
  protectedReferences,
  onPurged,
}: {
  readonly workspace: Workspace;
  readonly store?: WorkspaceStore | undefined;
  readonly save?: StudyCommandSave | undefined;
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
}) {
  const recovery = useWorkspaceRecovery(workspace, store, save, protectedReferences, onPurged);
  const [selected, setSelected] = useState("");
  const entry = recovery.entries.find((item) => item.createdAt === selected);
  const restoreSelected = () => {
    if (!entry) return;
    Alert.alert(
      "Restore earlier content?",
      "Earlier content and study settings will replace their current versions. Newer cards and review history are preserved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () => {
            recovery.restore(entry);
          },
        },
      ],
    );
  };
  return (
    <View className="gap-3 border-t py-4">
      <Text className="font-bold">Recovery points</Text>
      <Text>
        Saved on this device every 30 minutes when changes are saved. Attachments use the files
        already on this device.
      </Text>
      {recovery.canCheckStorage && (
        <NativeButton
          label="Check storage integrity"
          tone="soft"
          disabled={recovery.busy}
          onPress={recovery.checkStorage}
        />
      )}
      <NativeSelect
        label="Recovery point"
        value={selected}
        onValueChange={setSelected}
        options={[
          { label: "Choose a recovery point", value: "" },
          ...recovery.entries.map((item) => ({
            label: new Date(item.createdAt).toLocaleString(),
            value: item.createdAt,
          })),
        ]}
      />
      <NativeButton
        label="Restore content"
        disabled={!entry || !save || recovery.busy}
        onPress={restoreSelected}
      />
      <NativeButton
        label="Repair missing objective links"
        tone="soft"
        disabled={!save || recovery.busy}
        onPress={recovery.repair}
      />
      {recovery.canPurge && (
        <NativeButton
          label="Empty file trash"
          tone="soft"
          disabled={!workspace.mediaTrash?.length || recovery.busy}
          onPress={() => {
            Alert.alert(
              "Permanently delete unused files?",
              "Files used by cards, history, drafts or recovery points are protected. Other trashed files will be permanently deleted.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete unused files", style: "destructive", onPress: recovery.purge },
              ],
            );
          }}
        />
      )}
      {recovery.message || recovery.controls.message ? (
        <Text accessibilityLiveRegion="polite">
          {recovery.controls.message || recovery.message}
        </Text>
      ) : null}
    </View>
  );
}
