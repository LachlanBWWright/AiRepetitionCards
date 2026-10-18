import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";

export function NativeOfflineReliabilityStatus({
  status,
  onRetry,
}: {
  readonly status: "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted";
  readonly onRetry?: () => void;
}) {
  const label =
    status === "saved-locally"
      ? "Saved on this device"
      : status === "synchronized"
        ? "Synchronized"
        : status === "awaiting-sync"
          ? "Awaiting account sync"
          : "Sync conflict needs attention";
  const classes =
    status === "saved-locally" || status === "synchronized"
      ? "border-green-300 bg-green-50 text-green-900"
      : status === "awaiting-sync"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-900";
  return (
    <View className="flex-row flex-wrap items-center gap-2" accessibilityLiveRegion="polite">
      <Text
        accessibilityRole="text"
        className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}
      >
        {label}
      </Text>
      {status !== "saved-locally" && status !== "synchronized" && onRetry && (
        <NativeButton label="Retry sync" tone="soft" onPress={onRetry} />
      )}
    </View>
  );
}
