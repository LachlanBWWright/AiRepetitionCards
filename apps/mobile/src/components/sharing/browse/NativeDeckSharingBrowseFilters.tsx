import { builtinActivityRegistry } from "@recall/application";
import { View } from "react-native";
import { NativeSelect } from "@recall/ui-native";
import { NativeButton } from "../../ui/NativeButton";
import { NativeTextField } from "../../ui/NativeTextField";
import type { NativeDeckSharingBrowseFilters } from "./useNativeDeckSharingBrowseFilters";

type Props = {
  readonly filters: NativeDeckSharingBrowseFilters;
  readonly onFilterChange: <K extends keyof NativeDeckSharingBrowseFilters>(
    key: K,
    value: NativeDeckSharingBrowseFilters[K],
  ) => void;
  readonly busy: boolean;
  readonly onSearch: (cursor: string | null) => void;
  readonly availableActivityTypes: readonly string[];
};

const decodeDifficulty = (value: string): NativeDeckSharingBrowseFilters["difficulty"] =>
  value === "beginner" || value === "intermediate" || value === "advanced" ? value : "";

const activityTypeLabel = (type: string): string => {
  if (type === "basic") return "Basic flashcards";
  if (type === "cloze") return "Cloze cards";
  return builtinActivityRegistry.find((plugin) => plugin.id === type)?.label ?? type;
};

export function NativeDeckSharingBrowseFiltersView({
  filters,
  onFilterChange,
  busy,
  onSearch,
  availableActivityTypes,
}: Props) {
  const activityTypes = [
    ...new Set([
      ...builtinActivityRegistry.map((plugin) => plugin.id),
      ...availableActivityTypes,
      ...(filters.activityType ? [filters.activityType] : []),
    ]),
  ]
    .sort()
    .map((type) => ({ label: activityTypeLabel(type), value: type }));

  return (
    <View className="gap-3">
      <NativeTextField
        label="Search decks"
        value={filters.query}
        onChangeText={(value) => {
          onFilterChange("query", value);
        }}
        placeholder="Title or description"
      />
      <NativeTextField
        label="Language filter"
        value={filters.language}
        onChangeText={(value) => {
          onFilterChange("language", value);
        }}
        placeholder="e.g. en"
      />
      <NativeTextField
        label="Topic or tag"
        value={filters.tag}
        onChangeText={(value) => {
          onFilterChange("tag", value);
        }}
        placeholder="e.g. biology"
      />
      <NativeSelect
        label="Author-declared difficulty"
        value={filters.difficulty}
        options={[
          { label: "Any difficulty", value: "" },
          { label: "Beginner", value: "beginner" },
          { label: "Intermediate", value: "intermediate" },
          { label: "Advanced", value: "advanced" },
        ]}
        onValueChange={(value) => {
          onFilterChange("difficulty", decodeDifficulty(value));
        }}
      />
      <NativeSelect
        label="Activity or card type"
        value={filters.activityType}
        options={[{ label: "Any activity", value: "" }, ...activityTypes]}
        onValueChange={(value) => {
          onFilterChange("activityType", value);
        }}
      />
      <NativeSelect
        label="Estimated study time"
        value={filters.studyTime}
        options={[
          { label: "Any duration", value: "any" },
          { label: "Up to 10 minutes", value: "short" },
          { label: "11–30 minutes", value: "medium" },
          { label: "31 minutes or more", value: "long" },
        ]}
        onValueChange={(value) => {
          onFilterChange(
            "studyTime",
            value === "short" || value === "medium" || value === "long" ? value : "any",
          );
        }}
      />
      <NativeButton
        label="Search public decks"
        tone="soft"
        disabled={busy}
        onPress={() => {
          onSearch(null);
        }}
      />
    </View>
  );
}
