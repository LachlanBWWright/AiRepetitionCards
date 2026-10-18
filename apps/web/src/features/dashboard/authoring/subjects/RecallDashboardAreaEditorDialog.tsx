import type { SubmitEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { Input } from "@recall/ui-web/components/input";
import { RadioGroup, RadioGroupItem } from "@recall/ui-web/components/radio-group";
import { Pipette } from "lucide-react";

function AreaColorChoices({
  colors,
  color,
  onColorChange,
}: {
  readonly colors: readonly string[];
  readonly color: string;
  readonly onColorChange: (color: string) => void;
}) {
  return (
    <RadioGroup
      className="flex min-w-0 flex-1 flex-wrap gap-2"
      aria-label="Subject color"
      value={color}
      onValueChange={onColorChange}
    >
      {colors.map((option) => (
        <RadioGroupItem
          key={option}
          className={`size-8 shrink-0 rounded-full border border-[var(--line)] ${color === option ? "ring-2 ring-[var(--primary)]" : ""}`}
          aria-label={`Choose ${option} color`}
          style={{ backgroundColor: option }}
          value={option}
        />
      ))}
    </RadioGroup>
  );
}

function CustomAreaColorPicker({
  color,
  onColorChange,
}: {
  readonly color: string;
  readonly onColorChange: (color: string) => void;
}) {
  return (
    <label className="relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]">
      <Pipette aria-hidden="true" className="size-4" />
      <input
        type="color"
        aria-label="Choose a custom area color"
        title="Choose a custom area color"
        value={color}
        onChange={(event) => {
          onColorChange(event.target.value);
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}

function ReopenLatestAreaButton({
  disabled,
  onClick,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
      disabled={disabled}
      onClick={onClick}
    >
      Reopen latest saved area
    </Button>
  );
}

export function RecallDashboardAreaEditorDialog({
  open,
  onOpenChange,
  busy,
  interactionsDisabled,
  editing,
  error,
  stale,
  onReopenLatest,
  onSubmit,
  title,
  onTitleChange,
  color,
  onColorChange,
  colors,
  onCancel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly busy: boolean;
  readonly interactionsDisabled: boolean;
  readonly editing: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  readonly onReopenLatest: () => void;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  readonly color: string;
  readonly onColorChange: (color: string) => void;
  readonly colors: readonly string[];
  readonly onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <form
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
          aria-busy={busy}
          onSubmit={onSubmit}
        >
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute top-4 right-4 size-8 text-[var(--muted)] hover:bg-[var(--surface-hover)]"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close area editor"
          >
            ×
          </Button>
          <DialogHeader className="pr-10">
            <DialogTitle id="area-dialog-title">
              {editing ? "Edit subject" : "New subject"}
            </DialogTitle>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <p>{error}</p>
              {stale && editing && (
                <ReopenLatestAreaButton disabled={interactionsDisabled} onClick={onReopenLatest} />
              )}
            </Alert>
          )}
          <fieldset
            disabled={busy}
            className="grid gap-3"
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <label htmlFor="area-title">Subject name</label>
            <Input
              id="area-title"
              autoFocus
              value={title}
              onChange={(event) => {
                onTitleChange(event.target.value);
              }}
              placeholder="e.g. Organic chemistry"
              maxLength={80}
            />
            <p>Color (optional)</p>
            <div className="flex min-w-0 items-start gap-2">
              <AreaColorChoices colors={colors} color={color} onColorChange={onColorChange} />
              <CustomAreaColorPicker color={color} onColorChange={onColorChange} />
            </div>
            <DialogFooter className="flex items-center justify-end gap-2">
              <Button size="small" type="button" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="small" type="submit" disabled={busy || !title.trim()}>
                {busy ? "Saving area…" : editing ? "Save changes" : "Create subject"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
