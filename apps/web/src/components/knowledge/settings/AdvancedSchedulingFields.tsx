import { useSchedulingSteps } from "@recall/react";
import { toggleEasyDay } from "@recall/application";
import { useId } from "react";
import type { SchedulerPolicy } from "@recall/domain";
import { Input } from "@recall/ui-web";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

export function AdvancedSchedulingFields({
  policy,
  onChange,
}: {
  readonly policy: SchedulerPolicy;
  readonly onChange: (policy: SchedulerPolicy) => void;
}) {
  const id = useId();
  const { learning, relearning, updateSteps } = useSchedulingSteps(policy, onChange);
  const dayChoices = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
    <label key={day} className="flex items-center gap-1">
      <Checkbox
        checked={policy.easyDays?.includes(index) ?? false}
        onCheckedChange={(checked) => {
          onChange(toggleEasyDay(policy, index, checked === true));
        }}
      />
      {day}
    </label>
  ));
  return (
    <section className="grid gap-3 border-t pt-4" aria-label="Advanced scheduling">
      <h3 className="font-semibold">Scheduling adjustments</h3>
      <label htmlFor={`${id}-learn`}>
        Learning steps in minutes
        <Input
          id={`${id}-learn`}
          value={learning}
          onChange={(event) => {
            updateSteps(event.target.value, "learningSteps");
          }}
        />
      </label>
      <label htmlFor={`${id}-relearn`}>
        Relearning steps in minutes
        <Input
          id={`${id}-relearn`}
          value={relearning}
          onChange={(event) => {
            updateSteps(event.target.value, "relearningSteps");
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Use up to five increasing whole-minute delays, such as 1 10. Leave blank for FSRS-controlled
        scheduling.
      </p>
      <label htmlFor={`${id}-maximum`}>
        Maximum interval in days
        <Input
          id={`${id}-maximum`}
          type="number"
          min={1}
          max={36500}
          required
          value={Number.isNaN(policy.maximumInterval) ? "" : (policy.maximumInterval ?? 36500)}
          onChange={(event) => {
            onChange({
              ...policy,
              maximumInterval: event.target.value ? Number(event.target.value) : NaN,
            });
          }}
        />
      </label>
      <label htmlFor={`${id}-mix`}>New cards and established reviews</label>
      <Select
        value={policy.newReviewOrder ?? "after"}
        onValueChange={(value) => {
          if (value === "after" || value === "before" || value === "mix")
            onChange({ ...policy, newReviewOrder: value });
        }}
      >
        <SelectTrigger id={`${id}-mix`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="after">New cards after reviews</SelectItem>
          <SelectItem value="before">New cards before reviews</SelectItem>
          <SelectItem value="mix">Mix by due date</SelectItem>
        </SelectContent>
      </Select>
      <fieldset className="grid gap-2">
        <legend>Reduced-load days</legend>
        <div className="flex flex-wrap gap-3">{dayChoices}</div>
      </fieldset>
      <label htmlFor={`${id}-zone`}>
        Scheduling time zone
        <Input
          id={`${id}-zone`}
          value={policy.timeZone ?? "UTC"}
          placeholder="Australia/Sydney"
          onChange={(event) => {
            onChange({ ...policy, timeZone: event.target.value });
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Reduced-load days shift future review intervals by at most two days when possible. Existing
        due dates stay unchanged. Learning steps always come first.
      </p>
    </section>
  );
}
