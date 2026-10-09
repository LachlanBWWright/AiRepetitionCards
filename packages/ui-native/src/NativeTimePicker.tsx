import DateTimePicker from "@expo/ui/community/datetime-picker";
import { Platform } from "react-native";

export type NativeTimePickerProps = {
  readonly value: Date;
  readonly onValueChange: (value: Date) => void;
  readonly onDismiss?: () => void;
};

export function NativeTimePicker({ value, onValueChange, onDismiss }: NativeTimePickerProps) {
  return (
    <DateTimePicker
      value={value}
      mode="time"
      is24Hour
      display={Platform.OS === "ios" ? "compact" : "default"}
      presentation={Platform.OS === "android" ? "dialog" : "inline"}
      onValueChange={(_event, selectedTime) => {
        onValueChange(selectedTime);
      }}
      {...(onDismiss ? { onDismiss } : {})}
    />
  );
}
