import type { Workspace } from "@recall/domain";
import { Text, View } from "react-native";
import {
  useNativeStudyCommand,
  type NativeStudyCommand,
} from "../../hooks/use-native-study-command";
import { NativeButton } from "../ui/NativeButton";
export function NativeStudySyncConflict({
  workspace,
  save,
}: {
  readonly workspace: Workspace;
  readonly save?: NativeStudyCommand | undefined;
}) {
  const controls = useNativeStudyCommand(workspace, save);
  const conflict = workspace.studySettingsConflict;
  if (!conflict) return null;
  return (
    <View className="gap-3 border p-3">
      <Text className="font-bold">Study settings conflict</Text>
      <Text>
        Synced settings are active. Compare your preserved device settings, choose which to retain,
        then sync again.
      </Text>
      <Text>This device: {JSON.stringify(conflict.local, null, 2)}</Text>
      <Text>Synced settings: {JSON.stringify(conflict.remote, null, 2)}</Text>
      <NativeButton
        label="Use this device's settings"
        disabled={!save || controls.busy}
        onPress={() => {
          controls.commit({ kind: "resolve-study-settings", choice: "local" });
        }}
      />
      <NativeButton
        label="Keep synced settings"
        disabled={!save || controls.busy}
        onPress={() => {
          controls.commit({ kind: "resolve-study-settings", choice: "remote" });
        }}
      />
      {controls.message ? <Text>{controls.message}</Text> : null}
    </View>
  );
}
