import { useSchedulingSteps } from "@recall/react";
import { toggleEasyDay } from "@recall/application";
import { useId } from "react";
import type { SchedulerPolicy } from "@recall/domain";
import { Input, FieldLabel, FieldDescription } from "@recall/ui-web";
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
    <FieldLabel key={day} className="flex items-center gap-2">
      <Checkbox
        checked={policy.easyDays?.includes(index) ?? false}
        onCheckedChange={(checked) => {
          onChange(toggleEasyDay(policy, index, checked === true));
        }}
      />
      {day}
    </FieldLabel>
  ));
  return (
    <section className="flex flex-col gap-4" aria-label="Advanced scheduling">
      <h3 className="m-0 font-semibold">Scheduling adjustments</h3>
      <FieldLabel htmlFor={`${id}-learn`} className="flex min-w-0 flex-col gap-2">
        Learning steps in minutes
        <Input
          id={`${id}-learn`}
          value={learning}
          onChange={(event) => {
            updateSteps(event.target.value, "learningSteps");
          }}
        />
      </FieldLabel>
      <FieldLabel htmlFor={`${id}-relearn`} className="flex min-w-0 flex-col gap-2">
        Relearning steps in minutes
        <Input
          id={`${id}-relearn`}
          value={relearning}
          onChange={(event) => {
            updateSteps(event.target.value, "relearningSteps");
          }}
        />
      </FieldLabel>
      <FieldDescription>
        Use up to five increasing whole-minute delays, such as 1 10. Leave blank for FSRS-controlled
        scheduling.
      </FieldDescription>
      <FieldLabel htmlFor={`${id}-maximum`} className="flex min-w-0 flex-col gap-2">
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
      </FieldLabel>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`${id}-mix`}>New cards and established reviews</FieldLabel>
        <Select
          value={policy.newReviewOrder ?? "after"}
          onValueChange={(value) => {
            if (value === "after" || value === "before" || value === "mix")
              onChange({ ...policy, newReviewOrder: value });
          }}
        >
          <SelectTrigger id={`${id}-mix`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="after">New cards after reviews</SelectItem>
            <SelectItem value="before">New cards before reviews</SelectItem>
            <SelectItem value="mix">Mix by due date</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend>Reduced-load days</legend>
        <div className="flex flex-wrap gap-2">{dayChoices}</div>
      </fieldset>
      <FieldLabel htmlFor={`${id}-zone`} className="flex min-w-0 flex-col gap-2">
        Scheduling time zone
        <Input
          id={`${id}-zone`}
          value={policy.timeZone ?? "UTC"}
          placeholder="Australia/Sydney"
          onChange={(event) => {
            onChange({ ...policy, timeZone: event.target.value });
          }}
        />
      </FieldLabel>
      <FieldDescription>
        Reduced-load days shift future review intervals by at most two days when possible. Existing
        due dates stay unchanged. Learning steps always come first.
      </FieldDescription>
    </section>
  );
}
