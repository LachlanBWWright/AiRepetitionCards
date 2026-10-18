import { Pressable, Text, View } from "react-native";
import type { LearningArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

type Card = LearningArea["cards"][number];

export type NativeWorkspaceCardRowProps = {
  readonly card: Card;
  readonly selected: boolean;
  readonly flagged: boolean;
  readonly locked: boolean;
  readonly showMenu: boolean;
  readonly onSelect: () => void;
  readonly onEdit: () => void;
  readonly onToggleMenu: () => void;
  readonly onFlag: (() => void) | undefined;
  readonly onShowHistory: () => void;
  readonly onDelete: () => void;
};

function CardRowMenu({
  locked,
  flagged,
  onFlag,
  onEdit,
  onShowHistory,
  onDelete,
}: NativeWorkspaceCardRowProps) {
  return (
    <View className="gap-[8px] pb-[12px]">
      {onFlag && (
        <NativeButton
          label={flagged ? "Remove editing flag" : "Improve later"}
          tone="soft"
          disabled={locked}
          onPress={onFlag}
        />
      )}
      <NativeButton label="Edit" tone="soft" disabled={locked} onPress={onEdit} />
      <NativeButton label="Version history" tone="soft" disabled={locked} onPress={onShowHistory} />
      <NativeButton label="Delete" tone="soft" disabled={locked} onPress={onDelete} />
    </View>
  );
}

export function NativeWorkspaceCardRow(props: NativeWorkspaceCardRowProps) {
  const { card, selected, flagged, locked, showMenu, onSelect, onEdit, onToggleMenu } = props;
  return (
    <View className="border-t border-recall-line py-[8px]">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Select card: ${card.front}`}
        accessibilityState={{ checked: selected, disabled: locked }}
        disabled={locked}
        onPress={onSelect}
        className="min-h-12 justify-center"
      >
        <Text>
          {selected ? "☑ Selected" : "☐ Select card"}
          {flagged ? " · Flagged for editing" : ""}
        </Text>
      </Pressable>
      <View className="flex-row items-center justify-between gap-[12px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${card.front}`}
          disabled={locked}
          accessibilityState={{ disabled: locked }}
          onPress={onEdit}
          className="flex-1 min-h-[44px] justify-center"
        >
          <Text className="text-recall-ink text-[13px] font-semibold">{card.front}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${card.front}`}
          accessibilityState={{ expanded: showMenu, disabled: locked }}
          disabled={locked}
          onPress={onToggleMenu}
          className="min-w-[44px] min-h-[44px] items-center justify-center"
        >
          <Text className="text-recall-ink text-[16px] font-bold">⋯</Text>
        </Pressable>
      </View>
      {showMenu && <CardRowMenu {...props} />}
    </View>
  );
}
