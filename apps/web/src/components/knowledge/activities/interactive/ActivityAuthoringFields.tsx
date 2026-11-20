import { useId } from "react";
import type { ActivityAuthoringField } from "@recall/application";
import { Input, Label, Textarea } from "@recall/ui-web";
import { CardRichText } from "../../../cards/CardRichText";

export function ActivityAuthoringFields({
  pluginId,
  fields,
  value,
  disabled,
  onChange,
}: {
  readonly pluginId: string;
  readonly fields: readonly ActivityAuthoringField[];
  readonly value: (key: string) => string;
  readonly disabled: boolean;
  readonly onChange: (key: string, value: string) => void;
}) {
  const prefix = useId();
  const game = ["recall.ordering", "recall.matching", "recall.code-tracing"].includes(pluginId);
  return (
    <div className="grid gap-3">
      {game && (
        <div className="rounded-md bg-muted p-3 text-sm">
          {pluginId === "recall.ordering"
            ? "Write 2–20 items in their correct order. Learners see a shuffled list and can move items with buttons."
            : pluginId === "recall.matching"
              ? "Write 2–20 pairs, one per line, with exactly one | separating left and right. Learners match independently shuffled columns."
              : "Code is displayed for reasoning and never executed. Enter the exact expected output; trailing spaces and blank lines are ignored."}
          <p>Prompts and item text support rich formatting, inline code and math such as $x^2$.</p>
        </div>
      )}
      {fields.map((field) => {
        const id = `${prefix}-${field.key}`;
        const code = [
          "code",
          "expectedOutput",
          "tests",
          "starterCode",
          "script",
          "configuration",
        ].includes(field.key);
        const props = {
          id,
          value: value(field.key),
          disabled,
          maxLength: field.key === "payload" ? 100_000 : 20_000,
          className: code ? "min-h-32 font-mono" : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            onChange(field.key, event.target.value);
          },
        };
        return (
          <div key={field.key} className="grid gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            {field.multiline ? <Textarea {...props} /> : <Input {...props} />}
            {game && field.key === "prompt" && value(field.key) && (
              <div className="rounded-md border p-3">
                <p className="mb-2 text-xs text-muted-foreground">Prompt preview</p>
                <CardRichText text={value(field.key)} className="text-sm" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
