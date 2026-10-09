import { Text, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";

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
    <View className={`gap-[6px] ${className ?? ""}`}>
      <Text className="text-recall-ink text-[14px] font-semibold">{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityState={{ disabled: inputProps.editable === false }}
        value={value}
        onChangeText={onChangeText}
        className={`min-h-12 border border-recall-line rounded-[10px] px-3 py-[10px] bg-recall-surface text-recall-ink text-base ${inputClassName ?? ""}`}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-recall-coral text-[13px]">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
