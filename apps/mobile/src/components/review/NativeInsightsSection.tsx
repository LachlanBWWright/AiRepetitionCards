import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";

export function NativeInsightsSection({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <View className="rounded-xl border border-recall-line bg-recall-surface p-2">
      <NativeCollapsibleTrigger title={title} open={open} onToggle={onToggle} />
      <View className="px-3 pb-3">
        <Text className="text-sm text-recall-muted">{description}</Text>
      </View>
      <NativeCollapsibleContent open={open}>
        <View className="gap-4 px-3 pb-3 pt-3">{children}</View>
      </NativeCollapsibleContent>
    </View>
  );
}
