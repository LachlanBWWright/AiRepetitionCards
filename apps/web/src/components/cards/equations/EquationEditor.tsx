import { FieldError } from "@recall/ui-web/components/field";
import { Label } from "@recall/ui-web/components/label";
import { equationExamples } from "@recall/application";
import type { useEquationEditor } from "@recall/react";
import { Button } from "@recall/ui-web";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@recall/ui-web/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { Textarea } from "@recall/ui-web/components/textarea";
import { CardEquation } from "../CardEquation";
import { useId, type ChangeEvent } from "react";

export function EquationEditor({
  editor,
  onInsert,
}: {
  readonly editor: ReturnType<typeof useEquationEditor>;
  readonly onInsert: () => void;
}) {
  const id = useId();
  const updateSource = (event: ChangeEvent<HTMLTextAreaElement>) => {
    editor.setSource(event.target.value);
  };
  const status = editor.pending
    ? "Updating preview…"
    : editor.draft?.source.trim()
      ? "Equation is ready to insert."
      : "Enter an equation or choose an example to begin.";
  const preview = editor.draft?.source.trim() ? (
    <CardEquation source={editor.draft.source} display={editor.draft.display} />
  ) : (
    <p className="text-sm text-muted-foreground">Your equation preview will appear here.</p>
  );
  return (
    <Dialog
      open={editor.draft !== null}
      onOpenChange={(open) => {
        if (!open) editor.close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Equation editor</DialogTitle>
          <DialogDescription>
            Write TeX notation, preview it, then insert it into your card.
          </DialogDescription>
        </DialogHeader>
        {editor.draft && (
          <div className="flex flex-col gap-4">
            <EquationLayout display={editor.draft.display} onChange={editor.setDisplay} />
            <EquationExamples onChoose={editor.setSource} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>TeX equation</Label>
              <Textarea
                id={id}
                className="font-mono"
                value={editor.draft.source}
                onChange={updateSource}
                maxLength={4000}
                rows={4}
                aria-invalid={Boolean(editor.error)}
                aria-describedby={`${id}-status`}
                placeholder="\frac{a}{b}"
              />
            </div>
            <div
              className="min-h-16 overflow-x-auto rounded-md border p-4"
              aria-label="Equation preview"
            >
              {preview}
            </div>
            {editor.error && !editor.pending ? (
              <FieldError id={`${id}-status`}>{editor.error}</FieldError>
            ) : (
              <p id={`${id}-status`} role="status" className="text-sm text-muted-foreground">
                {status}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={editor.close}>
                Cancel
              </Button>
              <Button type="button" disabled={!editor.canInsert} onClick={onInsert}>
                Insert equation
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EquationExamples({ onChoose }: { readonly onChoose: (source: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Equation examples">
      {equationExamples.map((example) => (
        <Button
          key={example.label}
          type="button"
          variant="secondary"
          size="default"
          onClick={() => {
            onChoose(example.source);
          }}
        >
          {example.label}
        </Button>
      ))}
    </div>
  );
}

function EquationLayout({
  display,
  onChange,
}: {
  readonly display: boolean;
  readonly onChange: (display: boolean) => void;
}) {
  return (
    <Label className="flex flex-col gap-2">
      <span>Equation layout</span>
      <Select
        value={display ? "display" : "inline"}
        onValueChange={(value) => {
          onChange(value === "display");
        }}
      >
        <SelectTrigger className="w-full" aria-label="Equation layout">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inline">Inline · within a sentence</SelectItem>
          <SelectItem value="display">Display · on its own line</SelectItem>
        </SelectContent>
      </Select>
    </Label>
  );
}
