import { Pressable, Text, type AccessibilityState, type PressableProps } from "react-native";

export type NativeButtonVariant = "default" | "secondary" | "destructive" | "ghost";
export type NativeButtonPrimitiveProps = Omit<PressableProps, "className"> & {
  readonly variant?: NativeButtonVariant;
  readonly layout?: "row" | "column";
  readonly size?: "default" | "icon" | "rating";
  readonly className?: string | undefined;
};
const variants = {
  default: "bg-recall-action",
  secondary: "border border-recall-line bg-recall-surface",
  ghost: "bg-transparent",
  destructive: "bg-recall-danger",
} as const;

export function NativeButtonPrimitive({
  variant = "default",
  layout = "row",
  size = "default",
  disabled = false,
  className,
  accessibilityState,
  ...props
}: NativeButtonPrimitiveProps) {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      disabled={disabled ?? false}
      accessibilityState={{ ...accessibilityState, disabled: disabled ?? false }}
      className={`min-h-12 ${size === "rating" ? "flex-col items-center" : layout === "column" ? "flex-col items-start" : "flex-row items-center"} justify-center gap-2 rounded-[8px] py-3 ${size === "icon" ? "w-12 px-0" : size === "rating" ? "px-2" : "px-4"} ${accessibilityState?.selected ? "border border-recall-action bg-recall-action" : variants[variant]} ${disabled ? "opacity-50" : "active:opacity-80"} ${className ?? ""}`}
    />
  );
}

export type NativeButtonProps = {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityState?: AccessibilityState;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly variant?: NativeButtonVariant;
  readonly size?: "default" | "icon";
  readonly disabled?: boolean;
  readonly className?: string | undefined;
};

export function NativeButton({
  label,
  accessibilityLabel,
  accessibilityState,
  selected,
  onPress,
  variant = "default",
  size,
  disabled = false,
  className,
}: NativeButtonProps) {
  return (
    <NativeButtonPrimitive
      variant={variant}
      {...(size ? { size } : {})}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        ...accessibilityState,
        ...(selected === undefined ? {} : { selected }),
      }}
      className={className}
    >
      <Text className="text-center text-[14px] font-medium text-white">{label}</Text>
    </NativeButtonPrimitive>
  );
}
