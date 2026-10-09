import type { ChangeEvent } from "react";
import { Text, View } from "react-native";

type NativeSelectOption = { readonly label: string; readonly value: string };

export function NativeSelect({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly NativeSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text>{label}</Text>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </View>
  );
}

export function NativeTimePicker({
  value,
  onValueChange,
}: {
  readonly value: Date;
  readonly onValueChange: (value: Date) => void;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = event.target.value.split(":").map(Number);
    if (hours === undefined || minutes === undefined) return;
    const next = new Date(value);
    next.setHours(hours, minutes, 0, 0);
    onValueChange(next);
  };
  return (
    <input
      aria-label="Study reminder time"
      type="time"
      value={`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`}
      onChange={onChange}
    />
  );
}
