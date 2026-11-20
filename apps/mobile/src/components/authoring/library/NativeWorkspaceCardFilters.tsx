import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Pressable, Text } from "react-native";
import type { LearningArea } from "@recall/domain";

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
        <NativeCollapsibleTrigger
          open={showFilters}
          title="Filter"
          onToggle={() => {
            setShowFilters((value) => !value);
          }}
        />
      )}
      <NativeCollapsibleContent open={showFilters}>
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
              className="min-h-12 px-3 py-3 bg-recall-surface rounded-xl"
              onPress={() => {
                setObjectiveSelection({ areaId, value: choice.value });
              }}
            >
              <Text className="text-sm text-recall-ink">
                {objectiveFilter === choice.value ? "◉" : "○"} {choice.title}
              </Text>
            </Pressable>
          ))}
        </>
      </NativeCollapsibleContent>
    </>
  );
}
