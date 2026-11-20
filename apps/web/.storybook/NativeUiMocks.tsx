import type { ChangeEvent } from "react";
import { Text, View } from "react-native";
import { designTokens } from "@recall/design-tokens";

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
      <Text style={{ color: designTokens.color.muted, fontSize: 13 }}>{label}</Text>
      <select
        data-native-control-mock="picker"
        style={{
          minHeight: 48,
          border: `1px solid ${designTokens.color.line}`,
          borderRadius: 10,
          padding: "10px 12px",
          background: designTokens.color.surface,
          color: designTokens.color.ink,
          fontSize: 16,
          width: "100%",
          opacity: disabled ? 0.5 : 1,
        }}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
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

export { NativeTextField } from "../../../packages/ui-native/src/NativeTextField";

export { NativeButton } from "../../../packages/ui-native/src/NativeButton";
export { NativeButtonPrimitive } from "../../../packages/ui-native/src/NativeButton";
export {
  NativeCollapsible,
  NativeCollapsibleTrigger,
  NativeCollapsibleContent,
} from "../../../packages/ui-native/src/NativeCollapsible";

export { NativeButtonText } from "../../../packages/ui-native/src/NativeButtonText";
export { NativeWorkflowSections } from "../../../packages/ui-native/src/NativeWorkflowSections";

export { NativeNavigationLink } from "../../../packages/ui-native/src/NativeNavigationLink";
