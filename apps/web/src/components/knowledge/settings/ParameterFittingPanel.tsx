import { useParameterFitting } from "@recall/react";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { Input } from "@recall/ui-web";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";

export function ParameterFittingPanel({
  workspace,
  settings,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const { proposal, setProposal, message, setMessage, busy, fit, cancel } = useParameterFitting(
    workspace,
    settings,
  );
  return (
    <section
      className="grid gap-3 border-t pt-4"
      aria-label="Personalized scheduling"
      aria-busy={busy}
    >
      <h3 className="font-semibold">Personalized scheduling</h3>
      <p className="text-sm text-muted-foreground">
        Experimental local fitting checks predictions against the latest 20% of answers, excluded
        from fitting. Uses all available card histories; no history leaves this device.
      </p>
      <label className="grid gap-1">
        Exclude answers before (UTC)
        <Input
          type="date"
          value={settings.optimizationReviewedAfter?.slice(0, 10) ?? ""}
          disabled={busy}
          onChange={(event) => {
            onChange({
              ...settings,
              optimizationReviewedAfter: event.target.value
                ? `${event.target.value}T00:00:00.000Z`
                : undefined,
            });
            setProposal(null);
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={settings.rescheduleOnParameterChange ?? false}
          disabled={busy}
          onCheckedChange={(checked) => {
            onChange({ ...settings, rescheduleOnParameterChange: checked === true });
          }}
        />
        Recalculate reviewed cards’ due dates when parameters change on save
      </label>
      <p className="text-sm text-muted-foreground">
        Earlier answers still establish memory state. Due-date recalculation preserves memory state
        and answer history; new and learning cards keep their dates.
      </p>
      <p>
        {settings.weights ? "Personalized parameters selected" : "Default FSRS parameters selected"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={fit}>
          {busy ? "Fitting parameters…" : "Fit parameters to my reviews"}
        </Button>
        {busy && (
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancel fitting
          </Button>
        )}
        {settings.weights && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const defaults = { ...settings };
              delete defaults.weights;
              onChange(defaults);
            }}
          >
            Use default parameters
          </Button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {proposal && (
        <div role="status" className="grid gap-2">
          <p>
            {proposal.reviewsProcessed.toLocaleString()} reviews across{" "}
            {proposal.cardsProcessed.toLocaleString()} cards evaluated.
          </p>
          <p>
            Temporal holdout RMSE: {proposal.baselineRmse.toFixed(3)} →{" "}
            {proposal.fittedRmse.toFixed(3)}. Lower is better.
          </p>
          {proposal.calibration.map((bucket, index) => (
            <p key={index}>
              Predicted {(bucket.predicted * 100).toFixed(0)}% · observed{" "}
              {(bucket.observed * 100).toFixed(0)}% ({bucket.count} answers)
            </p>
          ))}
          <p>
            {proposal.improved
              ? `Validation loss improved from ${proposal.baselineLoss.toFixed(3)} to ${proposal.fittedLoss.toFixed(3)} on ${String(proposal.validationObservations)} answers. Lower is better.`
              : "No validated improvement found. Keep the current parameters."}
          </p>
          {proposal.improved && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onChange({ ...settings, weights: proposal.weights });
                setMessage("Parameters added to this draft. Save settings to apply.");
                setProposal(null);
              }}
            >
              Use proposed parameters
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
