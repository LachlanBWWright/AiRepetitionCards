import type { Dispatch, SetStateAction } from "react";
import { Pressable, Text, View } from "react-native";
import type { LearningArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

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
  readonly now: number;
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
  now,
  hasWorkspace,
}: NativeWorkspaceDeckControlsProps) {
  return (
    <>
      <View className="flex-row items-center justify-between gap-[12px]">
        <Text className="text-recall-ink text-[16px] font-bold">{area.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deck actions"
          accessibilityState={{ expanded: areaMenu, disabled: locked }}
          disabled={locked}
          onPress={() => {
            setAreaMenu((value) => !value);
          }}
          className="min-w-[44px] min-h-[44px] items-center justify-center"
        >
          <Text className="text-recall-ink text-[16px] font-bold">⋯</Text>
        </Pressable>
      </View>
      {areaMenu && (
        <View className="gap-[8px] pb-[12px]">
          <NativeButton label="Rename area" tone="soft" disabled={locked} onPress={onRename} />
          <NativeButton
            label="Subject settings"
            tone="soft"
            disabled={locked}
            onPress={onSettings}
          />
          <NativeButton
            label="Review settings"
            tone="soft"
            disabled={locked || !hasWorkspace}
            onPress={onScheduler}
          />
          <NativeButton label="Delete subject" tone="soft" disabled={locked} onPress={onDelete} />
        </View>
      )}
      <NativeButton label="Add card" tone="soft" disabled={locked} onPress={onAddCard} />
      {onGenerateCards && (
        <NativeButton
          label="Generate cards"
          tone="soft"
          disabled={locked}
          onPress={onGenerateCards}
        />
      )}
      {onStudy && (
        <NativeButton
          label={`Review ${String(area.cards.filter((card) => Date.parse(card.schedule.due) <= now).length)} due cards`}
          disabled={locked || !area.cards.some((card) => Date.parse(card.schedule.due) <= now)}
          onPress={() => {
            onStudy(area.id);
          }}
        />
      )}
    </>
  );
}
