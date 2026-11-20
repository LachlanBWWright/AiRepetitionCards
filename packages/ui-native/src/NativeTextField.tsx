import { Text, TextInput, View } from "react-native";
import { useState } from "react";
import { designTokens } from "@recall/design-tokens";
import type { TextInputProps } from "react-native";

export type NativeTextFieldProps = {
  readonly label: string;
  readonly hideLabel?: boolean;
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
  | "autoCorrect"
  | "onSubmitEditing"
  | "accessibilityLabel"
>;

export function NativeTextField({
  label,
  hideLabel = false,
  value,
  onChangeText,
  error,
  className,
  inputClassName,
  ...inputProps
}: NativeTextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View className={`gap-[6px] ${className ?? ""}`}>
      {!hideLabel && <Text className="text-recall-ink text-[14px] font-semibold">{label}</Text>}
      <TextInput
        {...inputProps}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        accessibilityState={{ disabled: inputProps.editable === false }}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        style={focused ? { borderColor: designTokens.color.darkGreen, borderWidth: 2 } : undefined}
        textAlignVertical={inputProps.multiline ? "top" : "center"}
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
