import { Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import { NativeLearningActivitiesPanel as Panel } from "../../activities/NativeLearningActivitiesPanel";
import type { LearningActivitiesProps } from "../../../hooks/use-learning-activities";
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

export function NativeReviewLearningActivities({
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
    <View className="gap-3">
      <Text>
        Practice linked to this card. Activities save separately; you choose the review rating.
      </Text>
      {activities.map((activity) => {
        const available =
          findActivityPlugin(registry, activity)?.capabilities.platforms.includes("native") ??
          false;
        return (
          <View key={activity.id} className="gap-2">
            <Text>{activity.title}</Text>
            <Text>{activity.fallback}</Text>
            <NativeButton
              label={
                available ? "Start linked activity" : "Activity unavailable — use the card instead"
              }
              variant="default"
              disabled={props.disabled || open || !available}
              onPress={() => {
                setSelected(activity.id);
                setOpen(true);
                onOpenChange(true);
              }}
            />
          </View>
        );
      })}
      {selected && (
        <View style={{ display: open ? "flex" : "none" }}>
          <Panel
            key={selected}
            {...props}
            library={library}
            activityIds={activities.map((entry) => entry.id)}
            initialActivityId={selected}
            onSave={save}
          />
        </View>
      )}
      {open && (
        <NativeButton
          label={"Return to card"}
          variant="default"
          disabled={Boolean(props.disabled)}
          onPress={() => {
            setOpen(false);
            onOpenChange(false);
            if (suggestion) onReturn();
          }}
        />
      )}
      {suggestion && (
        <Text>Suggested review rating: {suggestion}. Confirm with the card’s rating buttons.</Text>
      )}
    </View>
  );
}
