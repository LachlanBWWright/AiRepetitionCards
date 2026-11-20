import { describeWorkspaceSyncStatus, type SyncStatusInput } from "@recall/application";
import { Text, View } from "react-native";
export function NativeWorkspaceSyncStatus(input: Omit<SyncStatusInput, "storage" | "online">) {
  const status = describeWorkspaceSyncStatus({ ...input, storage: "device", online: true });
  return (
    <View accessibilityLiveRegion="polite" className="gap-2 border-b border-recall-line px-4 py-2">
      <Text className="text-xs font-bold text-recall-ink">{status.label}</Text>
      <Text className="text-xs text-recall-muted">{status.detail}</Text>
    </View>
  );
}
