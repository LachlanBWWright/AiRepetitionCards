import { Pressable, Text } from "react-native";

export function NativeNavigationLink({
  label,
  disabled = false,
  onPress,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flexShrink: 1 }}
      className={`min-h-12 min-w-0 max-w-full self-start justify-center ${disabled ? "opacity-50" : "active:opacity-80"}`}
    >
      <Text className="text-sm font-semibold text-recall-darkGreen underline">{label}</Text>
    </Pressable>
  );
}
