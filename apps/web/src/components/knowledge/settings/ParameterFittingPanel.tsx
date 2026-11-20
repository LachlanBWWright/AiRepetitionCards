import { useParameterFitting } from "@recall/react";
import type { SchedulerSettings, Workspace } from "@recall/domain";
import { Input, FieldLabel, FieldDescription } from "@recall/ui-web";
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
    <section className="flex flex-col gap-4" aria-label="Personalized scheduling" aria-busy={busy}>
      <h3 className="m-0 font-semibold">Personalized scheduling</h3>
      <FieldDescription>
        Experimental local fitting checks predictions against the latest 20% of answers, excluded
        from fitting. Uses all available card histories; no history leaves this device.
      </FieldDescription>
      <FieldLabel className="flex flex-col gap-2">
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
      </FieldLabel>
      <FieldLabel className="flex items-center gap-2">
        <Checkbox
          checked={settings.rescheduleOnParameterChange ?? false}
          disabled={busy}
          onCheckedChange={(checked) => {
            onChange({ ...settings, rescheduleOnParameterChange: checked === true });
          }}
        />
        Recalculate reviewed cards’ due dates when parameters change on save
      </FieldLabel>
      <FieldDescription>
        Earlier answers still establish memory state. Due-date recalculation preserves memory state
        and answer history; new and learning cards keep their dates.
      </FieldDescription>
      <p className="m-0">
        {settings.weights ? "Personalized parameters selected" : "Default FSRS parameters selected"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" disabled={busy} onClick={fit}>
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
            variant="default"
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
      {message && (
        <p className="m-0" role="status">
          {message}
        </p>
      )}
      {proposal && (
        <div role="status" className="flex flex-col gap-2">
          <p className="m-0">
            {proposal.reviewsProcessed.toLocaleString()} reviews across{" "}
            {proposal.cardsProcessed.toLocaleString()} cards evaluated.
          </p>
          <p className="m-0">
            Temporal holdout RMSE: {proposal.baselineRmse.toFixed(3)} →{" "}
            {proposal.fittedRmse.toFixed(3)}. Lower is better.
          </p>
          {proposal.calibration.map((bucket, index) => (
            <p className="m-0" key={index}>
              Predicted {(bucket.predicted * 100).toFixed(0)}% · observed{" "}
              {(bucket.observed * 100).toFixed(0)}% ({bucket.count} answers)
            </p>
          ))}
          <p className="m-0">
            {proposal.improved
              ? `Validation loss improved from ${proposal.baselineLoss.toFixed(3)} to ${proposal.fittedLoss.toFixed(3)} on ${String(proposal.validationObservations)} answers. Lower is better.`
              : "No validated improvement found. Keep the current parameters."}
          </p>
          {proposal.improved && (
            <Button
              type="button"
              variant="default"
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
