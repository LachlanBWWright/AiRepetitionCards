import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Pressable, Text } from "react-native";
import type { LearningArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

export type NativeWorkspaceObjectiveChoice = {
  readonly value: string;
  readonly title: string;
};

export type NativeWorkspaceCardFiltersProps = {
  readonly areaId: LearningArea["id"];
  readonly choices: readonly NativeWorkspaceObjectiveChoice[];
  readonly objectiveFilter: string;
  readonly setObjectiveSelection: Dispatch<
    SetStateAction<{ areaId: LearningArea["id"] | null; value: string }>
  >;
  readonly locked: boolean;
  readonly showFilters: boolean;
  readonly setShowFilters: Dispatch<SetStateAction<boolean>>;
  readonly query: string;
  readonly setQuery: Dispatch<SetStateAction<string>>;
  readonly renderField: (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
  ) => ReactNode;
};

export function NativeWorkspaceCardFilters({
  areaId,
  choices,
  objectiveFilter,
  setObjectiveSelection,
  locked,
  showFilters,
  setShowFilters,
  query,
  setQuery,
  renderField,
}: NativeWorkspaceCardFiltersProps) {
  return (
    <>
      {renderField("Search cards", query, setQuery)}
      {choices.length > 1 && (
        <NativeButton
          label={showFilters ? "Hide filters" : "Filter"}
          tone="soft"
          onPress={() => {
            setShowFilters((value) => !value);
          }}
        />
      )}
      {showFilters && (
        <>
          <Text className="text-recall-ink text-[13px] font-semibold">
            Filter by learning objective
          </Text>
          {choices.map((choice) => (
            <Pressable
              key={choice.value}
              disabled={locked}
              accessibilityRole="radio"
              accessibilityState={{
                selected: objectiveFilter === choice.value,
                disabled: locked,
              }}
              className="p-[10px] bg-recall-surface rounded-[8px]"
              onPress={() => {
                setObjectiveSelection({ areaId, value: choice.value });
              }}
            >
              <Text>
                {objectiveFilter === choice.value ? "◉" : "○"} {choice.title}
              </Text>
            </Pressable>
          ))}
        </>
      )}
    </>
  );
}
