import { Pressable, Text, View } from "react-native";
import type { LearningArea } from "@recall/domain";
import type { CardEditorField } from "./NativeWorkspaceCardEditor";
import { NativeButton } from "../../ui/NativeButton";

type Objective = NonNullable<LearningArea["objectives"]>[number];
type Props = {
  readonly objective: Objective;
  readonly objectives: readonly Objective[];
  readonly field: CardEditorField;
  readonly locked: boolean;
  readonly onChange: (
    id: Objective["id"],
    changes: Partial<Pick<Objective, "title" | "description">>,
  ) => void;
  readonly onTogglePrerequisite: (
    objectiveId: Objective["id"],
    prerequisiteId: Objective["id"],
  ) => void;
  readonly onRemove: (id: Objective["id"]) => void;
};
export function NativeObjectiveEditor({
  objective,
  objectives,
  field,
  locked,
  onChange,
  onTogglePrerequisite,
  onRemove,
}: Props) {
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      {field("Objective title", objective.title, (title) => {
        onChange(objective.id, { title });
      })}
      {field(
        "Objective description",
        objective.description ?? "",
        (description) => {
          onChange(objective.id, { description });
        },
        true,
      )}
      <Text className={"text-recall-ink text-[13px] font-semibold"}>Prerequisites</Text>
      {objectives
        .filter((item) => item.id !== objective.id)
        .map((prerequisite) => (
          <Pressable
            key={prerequisite.id}
            disabled={locked}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: objective.prerequisiteIds.includes(prerequisite.id),
              disabled: locked,
            }}
            className={"p-[10px] bg-recall-surface rounded-[8px]"}
            onPress={() => {
              onTogglePrerequisite(objective.id, prerequisite.id);
            }}
          >
            <Text>
              {objective.prerequisiteIds.includes(prerequisite.id) ? "☑" : "☐"} {prerequisite.title}
            </Text>
          </Pressable>
        ))}
      {
        <NativeButton
          label={"Remove objective"}
          tone="soft"
          disabled={locked}
          onPress={() => {
            onRemove(objective.id);
          }}
        />
      }
    </View>
  );
}
