import { StudySessionFields } from "./StudySessionFields";
import { siblingBuryOptions } from "@recall/application";
import { TodayStudyLimits } from "./TodayStudyLimits";
import type { SchedulerSettings } from "@recall/domain";
import { Input, FieldLabel, FieldDescription } from "@recall/ui-web";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { useId } from "react";

export function StudyPolicyFields({
  settings,
  onChange,
  showTodayLimits = true,
}: {
  readonly showTodayLimits?: boolean;
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const id = useId();
  return (
    <section className="flex flex-col gap-4" aria-label="Study queue settings">
      <FieldLabel htmlFor={`${id}-new`} className="flex min-w-0 flex-col gap-2">
        New cards per day
        <Input
          id={`${id}-new`}
          type="number"
          min={0}
          max={1000}
          step={1}
          required
          value={Number.isNaN(settings.dailyNewLimit) ? "" : (settings.dailyNewLimit ?? 20)}
          onChange={(event) => {
            onChange({
              ...settings,
              dailyNewLimit: event.target.value === "" ? NaN : Number(event.target.value),
            });
          }}
        />
      </FieldLabel>
      <FieldLabel htmlFor={`${id}-reviews`} className="flex min-w-0 flex-col gap-2">
        Returning cards per day (blank is unlimited)
        <Input
          id={`${id}-reviews`}
          type="number"
          min={0}
          max={10000}
          value={settings.dailyReviewLimit ?? ""}
          onChange={(event) => {
            onChange({
              ...settings,
              dailyReviewLimit: event.target.value.trim() ? Number(event.target.value) : undefined,
            });
          }}
        />
      </FieldLabel>
      <StudySessionFields settings={settings} onChange={onChange} workspace={showTodayLimits} />
      {showTodayLimits && <TodayStudyLimits settings={settings} onChange={onChange} />}
      <FieldLabel className="flex items-center gap-2">
        <Checkbox
          checked={settings.pauseNewWhenOverdue ?? true}
          onCheckedChange={(checked) => {
            onChange({ ...settings, pauseNewWhenOverdue: checked === true });
          }}
        />
        Pause new cards while previous days’ reviews are overdue
      </FieldLabel>
      <fieldset className="flex flex-col gap-2">
        <legend className="m-0">Bury related cards until tomorrow</legend>
        {siblingBuryOptions.map(({ field, label }) => (
          <FieldLabel key={field} className="flex items-center gap-2">
            <Checkbox
              checked={settings[field] ?? settings.burySiblings ?? true}
              onCheckedChange={(checked) => {
                onChange({ ...settings, [field]: checked === true });
              }}
            />
            {label}
          </FieldLabel>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`${id}-order`}>Review order</FieldLabel>
        <Select
          value={settings.reviewOrder ?? "due"}
          onValueChange={(value) => {
            if (
              value === "due" ||
              value === "retrievability" ||
              value === "interval-ascending" ||
              value === "interval-descending"
            )
              onChange({ ...settings, reviewOrder: value });
          }}
        >
          <SelectTrigger id={`${id}-order`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="due">Oldest due first</SelectItem>
            <SelectItem value="retrievability">Lowest recall probability first</SelectItem>
            <SelectItem value="interval-ascending">Shortest interval first</SelectItem>
            <SelectItem value="interval-descending">Longest interval first</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <FieldLabel htmlFor={`${id}-leech`} className="flex min-w-0 flex-col gap-2">
        Flag repeatedly failed cards after this many lapses
        <Input
          id={`${id}-leech`}
          type="number"
          min={2}
          max={100}
          step={1}
          required
          value={Number.isNaN(settings.leechThreshold) ? "" : (settings.leechThreshold ?? 8)}
          onChange={(event) => {
            onChange({
              ...settings,
              leechThreshold: event.target.value === "" ? NaN : Number(event.target.value),
            });
          }}
        />
      </FieldLabel>
      <FieldDescription>
        Due learning and relearning steps stay available. Returning-card limits count each reviewed
        card once per day; retries use no extra slots. Deferred reviews remain in backlog counts. A
        study day follows the configured local start hour.
      </FieldDescription>
    </section>
  );
}
