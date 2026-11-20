import { Text, View } from "react-native";
import type { CardAppearance } from "@recall/domain";
import {
  CARD_APPEARANCE_OPTIONS,
  CARD_LAYOUT_PRESETS,
  DEFAULT_CARD_APPEARANCE,
} from "@recall/application";
import { NativeButton } from "../../ui/NativeButton";

type Props = {
  readonly value: CardAppearance | undefined;
  readonly onChange: (value: CardAppearance | undefined) => void;
  readonly disabled: boolean;
};
const fields = [
  ["font", "Typeface"],
  ["size", "Text size"],
  ["align", "Alignment"],
  ["lineSpacing", "Line spacing"],
  ["direction", "Reading direction"],
  ["imageSize", "Image size"],
] as const;
function AppearanceField({
  appearance,
  field,
  label,
  onChange,
  disabled,
}: {
  readonly appearance: CardAppearance;
  readonly field: keyof CardAppearance;
  readonly label: string;
  readonly onChange: Props["onChange"];
  readonly disabled: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-recall-muted">{label}</Text>
      <View className="flex-row flex-wrap gap-1">
        {CARD_APPEARANCE_OPTIONS[field].map((option) => (
          <NativeButton
            key={option.value}
            label={option.label}
            variant="default"
            selected={appearance[field] === option.value}
            disabled={disabled}
            onPress={() => {
              onChange({ ...appearance, [field]: option.value });
            }}
          />
        ))}
      </View>
    </View>
  );
}
export function NativeCardAppearanceSettings({ value, onChange, disabled }: Props) {
  const appearance = value ?? DEFAULT_CARD_APPEARANCE;
  return (
    <View className="gap-3">
      <NativeButton
        label={`Custom card appearance: ${value ? "on" : "off"}`}
        variant="default"
        disabled={disabled}
        onPress={() => {
          onChange(value ? undefined : appearance);
        }}
      />
      {value && (
        <View className="flex-row flex-wrap gap-1">
          {CARD_LAYOUT_PRESETS.map((preset) => (
            <NativeButton
              key={preset.id}
              label={preset.label}
              variant="default"
              disabled={disabled}
              onPress={() => {
                onChange(preset.appearance);
              }}
            />
          ))}
        </View>
      )}
      {value &&
        fields.map(([key, label]) => (
          <AppearanceField
            key={key}
            field={key}
            label={label}
            appearance={appearance}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
    </View>
  );
}
