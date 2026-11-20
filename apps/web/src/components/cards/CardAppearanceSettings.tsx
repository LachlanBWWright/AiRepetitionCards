import { Label } from "@recall/ui-web/components/label";
import type { CardAppearance } from "@recall/domain";
import {
  CARD_APPEARANCE_OPTIONS,
  CARD_LAYOUT_PRESETS,
  DEFAULT_CARD_APPEARANCE,
} from "@recall/application";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

type Props = {
  readonly value: CardAppearance | undefined;
  readonly onChange: (value: CardAppearance | undefined) => void;
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
}: {
  readonly appearance: CardAppearance;
  readonly field: keyof CardAppearance;
  readonly label: string;
  readonly onChange: Props["onChange"];
}) {
  return (
    <Label className="grid gap-2 text-sm">
      {label}
      <Select
        value={appearance[field] ?? (field === "direction" ? "auto" : "medium")}
        onValueChange={(next) => {
          const option = CARD_APPEARANCE_OPTIONS[field].find((item) => item.value === next);
          if (option) onChange({ ...appearance, [field]: option.value });
        }}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CARD_APPEARANCE_OPTIONS[field].map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Label>
  );
}
export function CardAppearanceSettings({ value, onChange }: Props) {
  const appearance = value ?? DEFAULT_CARD_APPEARANCE;
  return (
    <fieldset className="grid gap-4 rounded border p-3">
      <legend>Card appearance</legend>
      <Label className="flex items-center gap-2">
        <Checkbox
          checked={value !== undefined}
          onCheckedChange={(checked) => {
            onChange(checked === true ? appearance : undefined);
          }}
        />
        Customize card appearance
      </Label>
      {value && (
        <div className="grid gap-4 sm:grid-cols-2">
          <LayoutPreset onChange={onChange} />
          {fields.map(([key, label]) => (
            <AppearanceField
              key={key}
              field={key}
              label={label}
              appearance={appearance}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

function LayoutPreset({ onChange }: Pick<Props, "onChange">) {
  return (
    <Label className="grid gap-2 text-sm">
      Layout preset
      <Select
        onValueChange={(id) => {
          const preset = CARD_LAYOUT_PRESETS.find((item) => item.id === id);
          if (preset) onChange(preset.appearance);
        }}
      >
        <SelectTrigger className="w-full" aria-label="Layout preset">
          <SelectValue placeholder="Choose a preset" />
        </SelectTrigger>
        <SelectContent>
          {CARD_LAYOUT_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Label>
  );
}
