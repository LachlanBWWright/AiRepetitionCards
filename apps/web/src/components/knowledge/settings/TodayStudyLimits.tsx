import type { AreaId, SchedulerSettings } from "@recall/domain";
import { useTodayStudyLimits } from "@recall/react";
import { Input } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
export function TodayStudyLimits({
  settings,
  onChange,
  areaId,
}: {
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
  readonly areaId?: AreaId | undefined;
}) {
  const limits = useTodayStudyLimits(settings, onChange, Date.now, areaId);
  return (
    <fieldset className="grid gap-2 rounded border p-3">
      <legend>Today only</legend>
      <label>
        New cards today
        <Input
          type="number"
          min={0}
          max={1000}
          value={limits.newLimit}
          onChange={(event) => {
            limits.setNewLimit(event.target.value);
          }}
          placeholder="Keep usual limit"
        />
      </label>
      <label>
        Returning cards today
        <Input
          type="number"
          min={0}
          max={10000}
          value={limits.reviewLimit}
          onChange={(event) => {
            limits.setReviewLimit(event.target.value);
          }}
          placeholder="Keep usual limit"
        />
      </label>
      <Button type="button" disabled={!limits.canApply} onClick={limits.apply}>
        Apply to settings draft
      </Button>
      <p className="text-sm text-muted-foreground">
        Save settings to apply. Expires at local midnight on this device; synced devices use the
        same expiry instant.
      </p>
    </fieldset>
  );
}
