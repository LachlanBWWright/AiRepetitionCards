import { useId } from "react";
import type { SchedulerSettings } from "@recall/domain";
import { Input, FieldDescription } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

export function StudySessionFields({
  settings,
  onChange,
  workspace = false,
}: {
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
  readonly workspace?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      {workspace && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-day`}>Start the study day at (local hour, 0–23)</Label>
          <Input
            id={`${id}-day`}
            type="number"
            min={0}
            max={23}
            step={1}
            value={settings.studyDayStartHour ?? 0}
            onChange={(event) => {
              onChange({
                ...settings,
                studyDayStartHour: event.target.value.trim() ? Number(event.target.value) : NaN,
              });
            }}
          />
          <FieldDescription>
            Applies to daily limits, sibling burying and statistics across all subjects.
          </FieldDescription>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-ahead`}>Learn ahead when nothing else is due (minutes, 0–60)</Label>
        <Input
          id={`${id}-ahead`}
          type="number"
          min={0}
          max={60}
          step={1}
          value={settings.learnAheadMinutes ?? 0}
          onChange={(event) => {
            onChange({
              ...settings,
              learnAheadMinutes: event.target.value.trim() ? Number(event.target.value) : NaN,
            });
          }}
        />
        <FieldDescription>Zero waits until the full learning delay has elapsed.</FieldDescription>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-leech`}>When a reviewed card reaches the lapse threshold</Label>
        <Select
          value={settings.leechAction ?? "notify"}
          onValueChange={(value) => {
            if (value === "notify" || value === "suspend")
              onChange({ ...settings, leechAction: value });
          }}
        >
          <SelectTrigger id={`${id}-leech`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="notify">Flag for repair; keep reviewing</SelectItem>
            <SelectItem value="suspend">Suspend until I repair or resume it</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <FieldDescription>
        Applies to future failed reviews. Existing leeches are unchanged. Undo also reverses
        automatic suspension.
      </FieldDescription>
    </div>
  );
}
