import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

type TriggerProps = {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly title: string;
  readonly disabled?: boolean;
};

export function NativeCollapsibleTrigger({
  open,
  onToggle,
  title,
  disabled = false,
}: TriggerProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded: open, disabled }}
      aria-expanded={open}
      disabled={disabled}
      onPress={onToggle}
      className={`min-h-12 flex-row items-center justify-between gap-3 rounded-[8px] px-3 py-3 ${disabled ? "opacity-50" : "active:bg-recall-surface"}`}
    >
      <Text className="flex-1 text-[14px] font-medium text-recall-ink">{title}</Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="text-lg text-recall-muted"
      >
        {open ? "⌃" : "⌄"}
      </Text>
    </Pressable>
  );
}

export function NativeCollapsibleContent({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return open ? <View className="gap-3">{children}</View> : null;
}

export function NativeCollapsible({
  children,
  ...props
}: TriggerProps & { readonly children: ReactNode }) {
  return (
    <View className="gap-3">
      <NativeCollapsibleTrigger {...props} />
      <NativeCollapsibleContent open={props.open}>{children}</NativeCollapsibleContent>
    </View>
  );
}
