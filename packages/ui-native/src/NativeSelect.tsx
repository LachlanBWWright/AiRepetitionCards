import { Host, Picker } from "@expo/ui";
import { Text, View } from "react-native";

export type NativeSelectOption = {
  readonly label: string;
  readonly value: string;
};

export type NativeSelectProps = {
  readonly label: string;
  readonly value: string;
  readonly options: readonly NativeSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
};

export function NativeSelect({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
}: NativeSelectProps) {
  return (
    <View className="gap-1">
      <Text className="text-recall-muted text-[13px]">{label}</Text>
      <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
        <Picker selectedValue={value} onValueChange={onValueChange} enabled={!disabled}>
          {options.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </Host>
    </View>
  );
}
