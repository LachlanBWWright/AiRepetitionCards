import type { CardAppearance } from "@recall/domain";
import { CARD_APPEARANCE_OPTIONS, DEFAULT_CARD_APPEARANCE } from "@recall/application";
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
    <label className="grid gap-1 text-sm">
      {label}
      <Select
        value={appearance[field]}
        onValueChange={(next) => {
          const option = CARD_APPEARANCE_OPTIONS[field].find((item) => item.value === next);
          if (option) onChange({ ...appearance, [field]: option.value });
        }}
      >
        <SelectTrigger aria-label={label}>
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
    </label>
  );
}
export function CardAppearanceSettings({ value, onChange }: Props) {
  const appearance = value ?? DEFAULT_CARD_APPEARANCE;
  return (
    <fieldset className="grid gap-3 rounded border p-3">
      <legend>Card appearance</legend>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={value !== undefined}
          onCheckedChange={(checked) => {
            onChange(checked === true ? appearance : undefined);
          }}
        />
        Customize card appearance
      </label>
      {value && (
        <div className="grid gap-3 sm:grid-cols-2">
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
