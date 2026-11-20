import { Text, View } from "react-native";
import type { ActivityResponse } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

type Item = { readonly id: string; readonly text: string };
export type NativeOrderingActivityProps = {
  readonly items: readonly Item[];
  readonly response: ActivityResponse;
  readonly disabled: boolean;
  readonly onChange: (response: ActivityResponse) => void;
};

export function NativeOrderingActivity({
  items,
  response,
  disabled,
  onChange,
}: NativeOrderingActivityProps) {
  const selected = response.selectedOptionIds;
  const ordered = selected.flatMap((id) => items.filter((item) => item.id === id));
  const remaining = items.filter((item) => !selected.includes(item.id));
  function update(ids: readonly string[]) {
    onChange({ ...response, selectedOptionIds: ids, answers: [] });
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const next = selected.slice();
    const sourceId = selected[index];
    const targetId = selected[target];
    if (sourceId === undefined || targetId === undefined) return;
    next[index] = targetId;
    next[target] = sourceId;
    update(next);
  }
  return (
    <View className="gap-3">
      <Text>Select items in order, then use Move up or Move down to adjust your answer.</Text>
      <Text accessibilityLiveRegion="polite" className="text-sm text-recall-muted">
        {ordered.length} of {items.length} items placed
      </Text>
      {ordered.map((item, index) => (
        <View key={item.id} className="gap-2 rounded-xl border border-recall-line p-3">
          <Text>
            {index + 1}. {item.text}
          </Text>
          <NativeButton
            label="↑ Move up"
            accessibilityLabel={`Move ${item.text} up from position ${String(index + 1)}`}
            variant="default"
            disabled={disabled || index === 0}
            onPress={() => {
              move(index, -1);
            }}
          />
          <NativeButton
            label="↓ Move down"
            accessibilityLabel={`Move ${item.text} down from position ${String(index + 1)}`}
            variant="default"
            disabled={disabled || index === ordered.length - 1}
            onPress={() => {
              move(index, 1);
            }}
          />
          <NativeButton
            label="Remove from order"
            accessibilityLabel={`Remove ${item.text} from your order`}
            variant="default"
            disabled={disabled}
            onPress={() => {
              update(selected.filter((id) => id !== item.id));
            }}
          />
        </View>
      ))}
      {remaining.length > 0 && <Text className="font-bold">Available items</Text>}
      {remaining.map((item) => (
        <NativeButton
          key={item.id}
          label={`Add: ${item.text}`}
          accessibilityLabel={`Place ${item.text} at position ${String(selected.length + 1)}`}
          variant="default"
          disabled={disabled}
          onPress={() => {
            update([...selected, item.id]);
          }}
        />
      ))}
    </View>
  );
}
