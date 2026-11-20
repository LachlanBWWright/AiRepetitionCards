import { NativeButton } from "@recall/ui-native";

import type { Dispatch, SetStateAction } from "react";
import { Text, View } from "react-native";
import type { LearningArea } from "@recall/domain";

export type NativeWorkspaceDeckControlsProps = {
  readonly area: LearningArea;
  readonly areaMenu: boolean;
  readonly setAreaMenu: Dispatch<SetStateAction<boolean>>;
  readonly locked: boolean;
  readonly onRename: () => void;
  readonly onSettings: () => void;
  readonly onScheduler: () => void;
  readonly onDelete: () => void;
  readonly onAddCard: () => void;
  readonly onGenerateCards: (() => void) | undefined;
  readonly onStudy: ((areaId: LearningArea["id"]) => void) | undefined;
  readonly dueCount: number;
  readonly hasWorkspace: boolean;
};

export function NativeWorkspaceDeckControls({
  area,
  areaMenu,
  setAreaMenu,
  locked,
  onRename,
  onSettings,
  onScheduler,
  onDelete,
  onAddCard,
  onGenerateCards,
  onStudy,
  dueCount,
  hasWorkspace,
}: NativeWorkspaceDeckControlsProps) {
  return (
    <>
      <View className="flex-row items-center justify-between gap-[12px]">
        <Text className="text-recall-ink text-[16px] font-bold">{area.title}</Text>
        <NativeButton
          label="⋯"
          variant="secondary"
          size="icon"
          accessibilityLabel="Deck actions"
          accessibilityState={{ expanded: areaMenu, disabled: locked }}
          disabled={locked}
          onPress={() => {
            setAreaMenu((value) => !value);
          }}
        />
      </View>
      {areaMenu && (
        <View className="gap-[8px] pb-[12px]">
          <NativeButton
            label="Rename area"
            variant="secondary"
            disabled={locked}
            onPress={onRename}
          />
          <NativeButton
            label="Subject settings"
            variant="secondary"
            disabled={locked}
            onPress={onSettings}
          />
          <NativeButton
            label="Review settings"
            variant="secondary"
            disabled={locked || !hasWorkspace}
            onPress={onScheduler}
          />
          <NativeButton
            label="Delete subject"
            variant="destructive"
            disabled={locked}
            onPress={onDelete}
          />
        </View>
      )}
      <NativeButton label="Add card" variant="default" disabled={locked} onPress={onAddCard} />
      {onGenerateCards && (
        <NativeButton
          label="Generate cards"
          variant="secondary"
          disabled={locked}
          onPress={onGenerateCards}
        />
      )}
      {onStudy && (
        <NativeButton
          label={`Review ${String(dueCount)} due cards`}
          disabled={locked || dueCount === 0}
          onPress={() => {
            onStudy(area.id);
          }}
        />
      )}
    </>
  );
}
