import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";

export function NativeWorkspaceBackupActions({
  disabled,
  onSave,
  onRestore,
}: {
  readonly disabled: boolean;
  readonly onSave: () => void;
  readonly onRestore: () => void;
}) {
  return (
    <View className="gap-4">
      <View className="gap-4 pb-4">
        <View className="gap-1">
          <Text className="font-bold text-recall-ink">Save a backup</Text>
          <Text className="text-sm text-recall-muted">
            Save all decks, schedules, review history and attachments.
          </Text>
        </View>
        <NativeButton label="Save workspace backup" disabled={disabled} onPress={onSave} />
      </View>
      <View className="gap-4 border-t border-recall-line pt-4">
        <View className="gap-1">
          <Text className="font-bold text-recall-ink">Restore a backup</Text>
          <Text className="text-sm text-recall-muted">
            Choose a backup file to replace the current workspace.
          </Text>
        </View>
        <NativeButton
          label="Restore workspace backup"
          variant="default"
          disabled={disabled}
          onPress={onRestore}
        />
      </View>
      <Text className="text-sm text-recall-muted">
        Drafts and editing flags are stored separately from workspace backups.
      </Text>
    </View>
  );
}
