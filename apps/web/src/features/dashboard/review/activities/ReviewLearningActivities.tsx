import { Button } from "@recall/ui-web";
import { LearningActivitiesPanel as Panel } from "@/components/knowledge/activities/LearningActivitiesPanel";
import type { LearningActivitiesProps } from "@/hooks/use-learning-activities";
import { useRef, useState } from "react";
import {
  createLuaActivityRegistry,
  unavailableLuaRuntime,
  builtinActivityRegistry,
  findActivityPlugin,
} from "@recall/application";
import { emptyActivityLibrary, type Assessment, type ActivityLibrary } from "@recall/domain";

type Props = LearningActivitiesProps & {
  readonly card: Assessment;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAccepted: () => void;
  readonly onReturn: () => void;
};

export function ReviewLearningActivities({
  card,
  onOpenChange,
  onAccepted,
  onReturn,
  ...props
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const knownAttempts = useRef(new Set((props.library?.attempts ?? []).map((entry) => entry.id)));
  const library = props.library ?? emptyActivityLibrary;
  const registry = createLuaActivityRegistry(
    props.services?.lua ?? unavailableLuaRuntime,
    props.registry ?? builtinActivityRegistry,
  );
  const activities = library.activities.filter(
    (activity) =>
      activity.areaId === props.areaId &&
      !activity.archived &&
      (activity.id === `card:${card.id}` ||
        activity.sourceId === card.id ||
        activity.objectiveIds.some(
          (id) =>
            id === `card-objective:${card.id}` ||
            card.objectiveIds?.some((objective) => objective === id) ||
            (!card.objectiveIds?.length && id === `area:${props.areaId}:practice`),
        )),
  );
  if (activities.length === 0) return null;
  async function save(incoming: ActivityLibrary): Promise<boolean> {
    const saved = await props.onSave(incoming);
    if (!saved) return false;
    const accepted = incoming.attempts.find(
      (attempt) => !knownAttempts.current.has(attempt.id) && attempt.activity.id === selected,
    );
    incoming.attempts.forEach((attempt) => knownAttempts.current.add(attempt.id));
    if (accepted) {
      setSuggestion(
        accepted.result.suggestedReviewRating ?? "Choose the rating that reflects your recall",
      );
      onAccepted();
    }
    return true;
  }
  return (
    <section aria-label="Practice this card" className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Practice linked to this card. Activities save separately; you choose the review rating.
      </p>
      {activities.map((activity) => {
        const available =
          findActivityPlugin(registry, activity)?.capabilities.platforms.includes("web") ?? false;
        return (
          <div key={activity.id} className="grid gap-2">
            <p className="text-sm text-muted-foreground">{activity.title}</p>
            <p className="text-sm text-muted-foreground">{activity.fallback}</p>
            <Button
              variant="default"
              disabled={props.disabled || open || !available}
              onClick={() => {
                setSelected(activity.id);
                setOpen(true);
                onOpenChange(true);
              }}
            >
              {available ? "Start linked activity" : "Activity unavailable — use the card instead"}
            </Button>
          </div>
        );
      })}
      {selected && (
        <div hidden={!open}>
          <Panel
            key={selected}
            {...props}
            library={library}
            activityIds={activities.map((entry) => entry.id)}
            initialActivityId={selected}
            onSave={save}
          />
        </div>
      )}
      {open && (
        <Button
          variant="default"
          disabled={Boolean(props.disabled)}
          onClick={() => {
            setOpen(false);
            onOpenChange(false);
            if (suggestion) onReturn();
          }}
        >
          {"Return to card"}
        </Button>
      )}
      {suggestion && (
        <p className="text-sm text-muted-foreground">
          Suggested review rating: {suggestion}. Confirm with the card’s rating buttons.
        </p>
      )}
    </section>
  );
}
