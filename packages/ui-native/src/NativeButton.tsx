import { Pressable, Text } from "react-native";

export type NativeButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "dark" | "soft";
  readonly disabled?: boolean;
  readonly className?: string;
  readonly labelClassName?: string;
};

export function NativeButton({
  label,
  onPress,
  tone = "dark",
  disabled = false,
  className,
  labelClassName,
}: NativeButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-[8px] px-[18px] ${tone === "dark" ? "bg-recall-ink" : "mt-2 bg-recall-paper"} ${disabled ? "opacity-[0.45]" : ""} active:opacity-70 active:scale-[0.99] ${className ?? ""}`}
    >
      <Text
        className={`text-[13px] font-bold ${tone === "soft" ? "text-recall-ink" : "text-recall-surface"} ${labelClassName ?? ""}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
