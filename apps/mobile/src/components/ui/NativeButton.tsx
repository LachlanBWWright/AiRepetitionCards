import { Button } from "../../../components/ui/button";
import { Text } from "../../../components/ui/text";
import { cn } from "../../../lib/utils";

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
    <Button
      accessibilityState={{ disabled }}
      className={cn("min-h-12 rounded-xl", className)}
      disabled={disabled}
      onPress={onPress}
      variant={tone === "dark" ? "default" : "outline"}
    >
      <Text className={cn("font-bold", labelClassName)}>{label}</Text>
    </Button>
  );
}
