import type { ReviewPresentation, TypedAnswerSettings } from "@recall/domain";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { SpeechFieldSettings } from "./SpeechFieldSettings";
import { CardAppearanceSettings } from "./CardAppearanceSettings";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";

const typedOptions = [
  ["enabled", "Type answer before revealing"],
  ["ignoreCase", "Ignore letter case"],
  ["ignoreAccents", "Ignore accents"],
] as const;
export function ReviewPresentationSettings({
  value,
  onChange,
}: {
  readonly value: ReviewPresentation | undefined;
  readonly onChange: (value: ReviewPresentation) => void;
}) {
  const typed = value?.typedAnswer ?? { enabled: false, ignoreCase: true, ignoreAccents: false };
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="presentation">
        <AccordionTrigger>Appearance, answer and pronunciation</AccordionTrigger>
        <AccordionContent className="grid gap-3">
          <CardAppearanceSettings
            value={value?.appearance}
            onChange={(appearance) => {
              onChange({ ...value, appearance });
            }}
          />
          <TypedOptions
            typed={typed}
            onChange={(typedAnswer) => {
              onChange({ ...value, typedAnswer });
            }}
          />
          {(["front", "back"] as const).map((side) => (
            <SpeechFieldSettings
              key={side}
              side={side}
              speech={value?.speech?.[side]}
              update={(settings) => {
                onChange({ ...value, speech: { ...value?.speech, [side]: settings } });
              }}
            />
          ))}
          <p className="text-xs text-muted-foreground">
            Voices depend on this device. Speech never selects a review rating.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function TypedOptions({
  typed,
  onChange,
}: {
  readonly typed: TypedAnswerSettings;
  readonly onChange: (value: TypedAnswerSettings) => void;
}) {
  return (
    <div className="grid gap-2">
      {typedOptions.map(([key, label]) => (
        <label className="flex gap-2 items-center" key={key}>
          <Checkbox
            checked={typed[key]}
            onCheckedChange={(checked) => {
              onChange({ ...typed, [key]: checked === true });
            }}
          />
          {label}
        </label>
      ))}
    </div>
  );
}
