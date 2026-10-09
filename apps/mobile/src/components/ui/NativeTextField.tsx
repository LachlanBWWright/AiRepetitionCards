import type { TextInputProps } from "react-native";
import { Input } from "../../../components/ui/input";
import { Text } from "../../../components/ui/text";
import { View } from "react-native";
import { cn } from "../../../lib/utils";

export type NativeTextFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly error?: string;
  readonly className?: string;
  readonly inputClassName?: string;
} & Pick<
  TextInputProps,
  | "editable"
  | "keyboardType"
  | "maxLength"
  | "multiline"
  | "placeholder"
  | "returnKeyType"
  | "secureTextEntry"
  | "autoCapitalize"
  | "onSubmitEditing"
>;

export function NativeTextField({
  label,
  value,
  onChangeText,
  error,
  className,
  inputClassName,
  ...inputProps
}: NativeTextFieldProps) {
  return (
    <View className={cn("gap-1.5", className)}>
      <Text className="text-sm font-semibold">{label}</Text>
      <Input
        accessibilityLabel={label}
        accessibilityState={{ disabled: inputProps.editable === false }}
        aria-invalid={error ? true : undefined}
        className={cn("min-h-12 rounded-xl px-3 text-base", inputClassName)}
        onChangeText={onChangeText}
        value={value}
        {...inputProps}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
