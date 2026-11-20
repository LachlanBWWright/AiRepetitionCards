import { browserColumns, type BrowserColumn } from "@recall/application";
import { NativeButton } from "@recall/ui-native";
import { View } from "react-native";

export function NativeBrowserColumns({
  selected,
  disabled,
  onToggle,
}: {
  readonly selected: readonly BrowserColumn[];
  readonly disabled: boolean;
  readonly onToggle: (column: BrowserColumn) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {browserColumns.map((column) => (
        <NativeButton
          key={column}
          variant="secondary"
          selected={selected.includes(column)}
          disabled={disabled}
          label={column}
          onPress={() => {
            onToggle(column);
          }}
        />
      ))}
    </View>
  );
}
