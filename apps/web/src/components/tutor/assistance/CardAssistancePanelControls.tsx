import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { useId, type ChangeEvent } from "react";

export type CardAssistanceRefinementAction = "clearer" | "shorter" | "split" | "example" | "cloze";

const refinementActionLabels: Record<CardAssistanceRefinementAction, string> = {
  clearer: "Make clearer",
  shorter: "Shorten",
  split: "Split question",
  example: "Add example",
  cloze: "Convert to cloze",
};

export function CardAssistancePanelActionButton({
  action,
  disabled,
  onRefine,
}: {
  readonly action: CardAssistanceRefinementAction;
  readonly disabled: boolean;
  readonly onRefine: (action: CardAssistanceRefinementAction) => void;
}) {
  return (
    <Button
      variant="secondary"
      size="small"
      type="button"
      disabled={disabled}
      onClick={() => {
        onRefine(action);
      }}
    >
      {refinementActionLabels[action]}
    </Button>
  );
}

export function CardAssistancePanelInstructions({
  instruction,
  disabled,
  onChange,
  onSuggest,
}: {
  readonly instruction: string;
  readonly disabled: boolean;
  readonly onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onSuggest: () => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-sm">
        What should change?
      </Label>
      <Textarea
        id={id}
        className="min-h-20 w-full resize-y text-sm leading-6"
        rows={2}
        value={instruction}
        maxLength={1000}
        disabled={disabled}
        onChange={onChange}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !disabled &&
            instruction.trim()
          ) {
            event.preventDefault();
            onSuggest();
          }
        }}
        placeholder="e.g. Focus on why borrowing avoids the copy"
      />
      <Button
        className="justify-self-end"
        size="small"
        type="button"
        disabled={disabled || !instruction.trim()}
        onClick={onSuggest}
      >
        Suggest changes
      </Button>
    </div>
  );
}
