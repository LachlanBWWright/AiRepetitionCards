"use client";
import { Button, Checkbox, Label } from "@recall/ui-web";
import { useDeckUpdate, type DeckUpdateProps } from "../../../hooks/use-deck-update";

export function DeckUpdatePanel(props: DeckUpdateProps) {
  const model = useDeckUpdate(props);
  return (
    <section
      aria-label="Update your personal deck"
      className="my-4 grid gap-3 rounded-lg border p-4"
    >
      <h3 className="font-semibold">Update your personal deck</h3>
      <p className="text-sm text-muted-foreground">
        Choose the card and objective changes to accept. Your review history stays with your
        existing cards.
      </p>
      {!model.baseline && (
        <Button variant="secondary" disabled={model.busy} onClick={() => void model.load()}>
          Compare with original version
        </Button>
      )}
      {model.choices.map((choice, index) => (
        <div key={choice.id} className="flex items-start gap-2">
          <Checkbox
            id={`deck-change-${String(index)}`}
            checked={model.selected.includes(choice.id)}
            disabled={model.busy}
            onCheckedChange={(checked) => {
              model.toggle(choice.id, checked === true);
            }}
          />
          <Label htmlFor={`deck-change-${String(index)}`}>{choice.label}</Label>
        </div>
      ))}
      {model.conflicts.length > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="deck-update-conflicts"
            checked={model.confirmConflicts}
            disabled={model.busy}
            onCheckedChange={(checked) => {
              model.setConfirmConflicts(checked === true);
            }}
          />
          <Label htmlFor="deck-update-conflicts">
            Replace my local edits on these {model.conflicts.length} selected items
          </Label>
        </div>
      )}
      {model.message && (
        <p role="status" className="text-sm">
          {model.message}
        </p>
      )}
      {model.baseline && model.choices.length > 0 && (
        <Button
          disabled={
            model.busy ||
            model.selected.length === 0 ||
            (model.conflicts.length > 0 && !model.confirmConflicts)
          }
          onClick={() => void model.save()}
        >
          {model.busy ? "Saving…" : "Apply selected changes"}
        </Button>
      )}
    </section>
  );
}
