import { Button } from "../../../components/ui/button";
import { Text } from "../../../components/ui/text";
import { cn } from "../../../lib/utils";

export type NativeButtonProps = {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly tone?: "dark" | "soft";
  readonly disabled?: boolean;
  readonly className?: string;
  readonly labelClassName?: string;
};

export function NativeButton({
  label,
  accessibilityLabel,
  selected,
  onPress,
  tone = "dark",
  disabled = false,
  className,
  labelClassName,
}: NativeButtonProps) {
  return (
    <Button
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      accessibilityLabel={accessibilityLabel ?? label}
      className={cn("min-h-12 rounded-xl", className)}
      disabled={disabled}
      onPress={onPress}
      variant={tone === "dark" ? "default" : "outline"}
    >
      <Text className={cn("font-bold", labelClassName)}>{label}</Text>
    </Button>
  );
}
