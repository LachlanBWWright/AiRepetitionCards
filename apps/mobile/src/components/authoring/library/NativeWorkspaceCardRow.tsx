import { NativeButton, NativeButtonPrimitive, NativeButtonText } from "@recall/ui-native";

import { Pressable, Text, View } from "react-native";
import type { LearningArea } from "@recall/domain";

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
          variant="secondary"
          disabled={locked}
          onPress={onFlag}
        />
      )}
      <NativeButton label="Edit" variant="secondary" disabled={locked} onPress={onEdit} />
      <NativeButton
        label="Version history"
        variant="secondary"
        disabled={locked}
        onPress={onShowHistory}
      />
      <NativeButton label="Delete" variant="destructive" disabled={locked} onPress={onDelete} />
    </View>
  );
}

export function NativeWorkspaceCardRow(props: NativeWorkspaceCardRowProps) {
  const { card, selected, flagged, locked, showMenu, onSelect, onEdit, onToggleMenu } = props;
  return (
    <View className="border-t border-recall-line py-3">
      <View className="flex-row items-start gap-2">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Select card: ${card.front}`}
          accessibilityState={{ checked: selected, disabled: locked }}
          disabled={locked}
          onPress={onSelect}
          className="min-h-12 w-12 items-center justify-center"
        >
          <Text className="text-xl text-recall-muted">{selected ? "☑" : "☐"}</Text>
        </Pressable>
        <NativeButtonPrimitive
          variant="secondary"
          layout="column"
          className="flex-1"
          accessibilityLabel={`Edit ${card.front}`}
          disabled={locked}
          onPress={onEdit}
        >
          <NativeButtonText variant="secondary">{card.front}</NativeButtonText>
          {flagged && (
            <NativeButtonText variant="secondary" detail>
              Flagged for editing
            </NativeButtonText>
          )}
        </NativeButtonPrimitive>
        <NativeButton
          label="⋯"
          variant="secondary"
          size="icon"
          accessibilityLabel={`Actions for ${card.front}`}
          accessibilityState={{ expanded: showMenu, disabled: locked }}
          disabled={locked}
          onPress={onToggleMenu}
        />
      </View>
      {showMenu && <CardRowMenu {...props} />}
    </View>
  );
}
