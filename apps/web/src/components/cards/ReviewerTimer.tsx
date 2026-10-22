import { Button } from "@recall/ui-web/components/button";

export function ReviewerTimer({
  showTimer,
  elapsedSeconds,
  canAutoAdvance,
  running,
  toggle,
  disabled,
}: {
  readonly showTimer: boolean;
  readonly elapsedSeconds: number;
  readonly canAutoAdvance: boolean;
  readonly running: boolean;
  readonly toggle: () => void;
  readonly disabled: boolean;
}) {
  if (!showTimer && !canAutoAdvance) return null;
  return (
    <div className="flex items-center justify-end gap-3 pb-2 text-sm text-muted-foreground">
      {showTimer && (
        <span aria-label="Time on this side">
          {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}
        </span>
      )}
      {canAutoAdvance && (
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={toggle}
          aria-pressed={running}
        >
          {running ? "Stop auto-advance" : "Start auto-advance"}
        </Button>
      )}
    </div>
  );
}
