import { useFilteredStudy, adaptStudyCommandSave } from "@recall/react";
import { Text, View } from "react-native";
import { Either } from "effect";
import type { FilteredDeck, LearningArea, Workspace } from "@recall/domain";
import { CARD_SEARCH_HELP } from "@recall/application";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import { type NativeStudyCommand } from "../../hooks/use-native-study-command";

export function NativeFilteredStudy({
  workspace,
  area,
  now,
  save,
  onStart,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
  readonly onStart: (area: LearningArea, deck?: FilteredDeck) => void;
}) {
  const {
    deck,
    scope,
    setScope,
    mode,
    setMode,
    saveCollection,
    loadCollection,
    removeCollection,
    newCollection,
    query,
    setQuery,
    name,
    setName,
    limit,
    setLimit,
    order,
    setOrder,
    settings,
    filtered,
    controls,
    saveSearch,
    deleteSearch,
    filterReviews,
    canSaveSearch,
  } = useFilteredStudy(workspace, area, now, save ? adaptStudyCommandSave(save) : undefined);
  return (
    <View className="gap-3 border-b border-recall-line pb-4">
      <Text className="font-bold text-recall-ink">Filtered study collections</Text>
      <NativeSelect
        label="Study scope"
        value={scope}
        options={[
          ...workspace.areas.map((subject) => ({ label: subject.title, value: subject.id })),
          { label: "All subjects", value: "all" },
        ]}
        onValueChange={setScope}
      />
      <NativeSelect
        label="Answer behavior"
        value={mode}
        options={[
          { label: "Preview without scheduling", value: "preview" },
          { label: "Record answers and reschedule", value: "reschedule" },
        ]}
        onValueChange={(value) => {
          if (value === "preview" || value === "reschedule") setMode(value);
        }}
      />
      <Text>
        {mode === "reschedule"
          ? "Answers update original cards, even when early or above normal daily limits."
          : "Preview leaves schedules and answer history unchanged."}
      </Text>
      {!!settings.filteredDecks?.length && (
        <NativeSelect
          label="Saved study collections"
          value={deck.id}
          options={settings.filteredDecks.map((item) => ({ label: item.name, value: item.id }))}
          onValueChange={loadCollection}
        />
      )}
      <NativeButton label="New collection" tone="soft" onPress={newCollection} />
      <NativeButton
        label="Save collection"
        tone="soft"
        disabled={!save || !name.trim() || controls.busy || Either.isLeft(filtered)}
        onPress={saveCollection}
      />
      <NativeButton
        label="Delete collection"
        tone="soft"
        disabled={
          !save || controls.busy || !settings.filteredDecks?.some((item) => item.id === deck.id)
        }
        onPress={removeCollection}
      />
      <NativeTextField
        label="Card search"
        value={query}
        maxLength={500}
        autoCapitalize="none"
        onChangeText={setQuery}
      />
      <Text className="text-sm text-recall-muted">{CARD_SEARCH_HELP}</Text>
      {(settings.savedSearches?.length ?? 0) > 0 && (
        <NativeSelect
          label="Saved searches"
          value={query}
          options={[
            { label: "All cards", value: "" },
            ...(settings.savedSearches ?? []).map((search) => ({
              label: search.name,
              value: search.query,
            })),
          ]}
          onValueChange={setQuery}
        />
      )}
      <NativeTextField
        label="Card limit · 1 to 500"
        keyboardType="number-pad"
        value={limit}
        onChangeText={setLimit}
      />
      <NativeSelect
        label="Order"
        value={order}
        options={[
          { label: "Oldest due first", value: "due" },
          { label: "Lowest recall first", value: "weakest" },
          { label: "Shortest interval", value: "shortest" },
          { label: "Longest interval", value: "longest" },
        ]}
        onValueChange={(value) => {
          if (value === "due" || value === "weakest" || value === "shortest" || value === "longest")
            setOrder(value);
        }}
      />
      {Either.isLeft(filtered) ? (
        <Text accessibilityRole="alert">{filtered.left.message}</Text>
      ) : (
        <Text>{filtered.right.cards.length} cards selected; suspended cards are excluded.</Text>
      )}
      <NativeButton
        label="Rebuild and start collection"
        disabled={
          Either.isLeft(filtered) || (Either.isRight(filtered) && !filtered.right.cards.length)
        }
        onPress={() => {
          if (Either.isRight(filtered)) onStart(filtered.right, deck);
        }}
      />
      <NativeButton
        label="Filter scheduled reviews"
        tone="soft"
        disabled={!save || controls.busy || !query.trim() || Either.isLeft(filtered)}
        onPress={filterReviews}
      />
      <NativeTextField
        label="Save search as"
        value={name}
        maxLength={80}
        editable={!controls.busy}
        onChangeText={setName}
      />
      <NativeButton
        label="Save search"
        tone="soft"
        disabled={!canSaveSearch}
        onPress={saveSearch}
      />
      {settings.savedSearches?.some((search) => search.query === query) && (
        <NativeButton
          label="Delete this saved search"
          tone="soft"
          disabled={!save || controls.busy}
          onPress={deleteSearch}
        />
      )}
      {controls.message ? <Text accessibilityLiveRegion="polite">{controls.message}</Text> : null}
    </View>
  );
}
