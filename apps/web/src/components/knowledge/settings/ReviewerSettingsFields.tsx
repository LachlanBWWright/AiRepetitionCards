import { useId } from "react";
import {
  defaultReviewerSettings,
  type ReviewerSettings,
  type SchedulerSettings,
} from "@recall/domain";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@recall/ui-web";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

export function ReviewerSettingsFields({
  settings,
  onChange,
}: {
  readonly settings: SchedulerSettings;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const id = useId();
  const reviewer = settings.reviewer ?? defaultReviewerSettings;
  const update = (patch: Partial<ReviewerSettings>) => {
    onChange({ ...settings, reviewer: { ...reviewer, ...patch } });
  };
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="reviewer">
        <AccordionTrigger>Reviewer controls</AccordionTrigger>
        <AccordionContent>
          <ReviewerControlsFields reviewer={reviewer} update={update} id={id} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ReviewerControlsFields({
  reviewer,
  update,
  id,
}: {
  readonly reviewer: ReviewerSettings;
  readonly update: (patch: Partial<ReviewerSettings>) => void;
  readonly id: string;
}) {
  return (
    <div className="grid gap-4">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={reviewer.showTimer}
          onCheckedChange={(checked) => {
            update({ showTimer: checked === true });
          }}
        />
        Show elapsed time
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["questionSeconds", "answerSeconds"] as const).map((field) => (
          <label key={field} htmlFor={`${id}-${field}`}>
            {field === "questionSeconds" ? "Reveal after (seconds)" : "Rate after (seconds)"}
            <Input
              id={`${id}-${field}`}
              type="number"
              min={0}
              max={600}
              required
              value={Number.isNaN(reviewer[field]) ? "" : reviewer[field]}
              onChange={(event) => {
                update({ [field]: event.target.value ? Number(event.target.value) : NaN });
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Zero disables that step. Start auto-advance in the reviewer; it pauses when you leave the
        screen.
      </p>
      <ReviewerActionSelect
        label="Automatic rating"
        value={reviewer.answerAction}
        ratingOnly
        onChange={(value) => {
          if (value !== "reveal") update({ answerAction: value });
        }}
      />
      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <legend className="mb-2">Keyboard shortcuts</legend>
        {(["reveal", "again", "hard", "good", "easy"] as const).map((action) => (
          <label key={action} htmlFor={`${id}-${action}`} className="capitalize">
            {action}
            <Input
              id={`${id}-${action}`}
              maxLength={1}
              required
              aria-label={`${action} shortcut`}
              value={reviewer.shortcuts[action]}
              onChange={(event) => {
                update({ shortcuts: { ...reviewer.shortcuts, [action]: event.target.value } });
              }}
            />
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-muted-foreground">
        Use distinct letters, numbers, or a space. Enter also reveals the answer.
      </p>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={reviewer.swipeEnabled}
          onCheckedChange={(checked) => {
            update({ swipeEnabled: checked === true });
          }}
        />
        Enable swipe gestures
      </label>
      {reviewer.swipeEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ReviewerActionSelect
            label="Swipe left"
            value={reviewer.swipeLeft}
            onChange={(swipeLeft) => {
              update({ swipeLeft });
            }}
          />
          <ReviewerActionSelect
            label="Swipe right"
            value={reviewer.swipeRight}
            onChange={(swipeRight) => {
              update({ swipeRight });
            }}
          />
        </div>
      )}
    </div>
  );
}

function ReviewerActionSelect({
  label,
  value,
  ratingOnly = false,
  onChange,
}: {
  readonly label: string;
  readonly value: ReviewerSettings["swipeLeft"];
  readonly ratingOnly?: boolean;
  readonly onChange: (value: ReviewerSettings["swipeLeft"]) => void;
}) {
  const id = useId();
  const actions = ratingOnly
    ? ["again", "hard", "good", "easy"]
    : ["reveal", "again", "hard", "good", "easy"];
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>{label}</label>
      <Select
        value={value}
        onValueChange={(value) => {
          if (
            value === "reveal" ||
            value === "again" ||
            value === "hard" ||
            value === "good" ||
            value === "easy"
          )
            onChange(value);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {actions.map((action) => (
            <SelectItem key={action} value={action} className="capitalize">
              {action === "reveal" ? "Show answer" : action}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
