import type { AreaId, SchedulerSettings } from "@recall/domain";
import { useTodayStudyLimits } from "@recall/react";
import { Input, FieldLabel, FieldDescription } from "@recall/ui-web";
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
    <fieldset className="flex flex-col gap-2 rounded border p-3">
      <legend>Today only</legend>
      <FieldLabel className="flex min-w-0 flex-col gap-2">
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
      </FieldLabel>
      <FieldLabel className="flex min-w-0 flex-col gap-2">
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
      </FieldLabel>
      <Button type="button" disabled={!limits.canApply} onClick={limits.apply}>
        Apply to settings draft
      </Button>
      <FieldDescription>
        Save settings to apply. Expires at local midnight on this device; synced devices use the
        same expiry instant.
      </FieldDescription>
    </fieldset>
  );
}
