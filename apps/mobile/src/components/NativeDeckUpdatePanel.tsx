import { Pressable, Text, View } from "react-native";
import { useDeckUpdate, type DeckUpdateProps } from "../hooks/use-deck-update";
import { NativeButton } from "./ui/NativeButton";

export function NativeDeckUpdatePanel(props: DeckUpdateProps) {
  const model = useDeckUpdate(props);
  return (
    <View className="my-3 gap-3 rounded-xl border border-recall-line p-4">
      <Text className="font-semibold">Update your personal deck</Text>
      <Text className="text-sm text-recall-muted">
        Choose which card and objective changes to accept. Existing schedules and review history
        stay with your cards.
      </Text>
      {!model.baseline ? (
        <NativeButton
          label="Compare with original version"
          tone="soft"
          disabled={model.busy}
          onPress={() => void model.load()}
        />
      ) : null}
      {model.choices.map((choice) => {
        const checked = model.selected.includes(choice.id);
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: model.busy }}
            disabled={model.busy}
            onPress={() => model.toggle(choice.id, !checked)}
            className="min-h-11 flex-row items-center gap-3"
          >
            <View className="h-5 w-5 items-center justify-center rounded border border-recall-line">
              {checked ? <Text className="font-bold">✓</Text> : null}
            </View>
            <Text className="flex-1 text-sm">{choice.label}</Text>
          </Pressable>
        );
      })}
      {model.conflicts.length > 0 ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: model.confirmConflicts, disabled: model.busy }}
          disabled={model.busy}
          onPress={() => model.setConfirmConflicts(!model.confirmConflicts)}
          className="min-h-11 flex-row items-center gap-3"
        >
          <View className="h-5 w-5 items-center justify-center rounded border border-recall-line">
            {model.confirmConflicts ? <Text className="font-bold">✓</Text> : null}
          </View>
          <Text className="flex-1 text-sm">
            Replace my local edits on these {model.conflicts.length} selected items
          </Text>
        </Pressable>
      ) : null}
      {model.message ? (
        <Text accessibilityRole="alert" className="text-sm text-recall-muted">
          {model.message}
        </Text>
      ) : null}
      {model.baseline && model.choices.length > 0 ? (
        <NativeButton
          label={model.busy ? "Saving…" : "Apply selected changes"}
          disabled={
            model.busy ||
            model.selected.length === 0 ||
            (model.conflicts.length > 0 && !model.confirmConflicts)
          }
          onPress={() => void model.save()}
        />
      ) : null}
    </View>
  );
}
