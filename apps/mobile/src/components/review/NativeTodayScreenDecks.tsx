import { Pressable, Text, View } from "react-native";
import type { Workspace } from "@recall/domain";
import { NativeButton } from "../ui/NativeButton";

type Area = Workspace["areas"][number];

export function DeckListRow({
  area,
  areaDue,
  reviewPending,
  onSelect,
  onHideAnswer,
}: {
  readonly area: Area;
  readonly areaDue: number;
  readonly reviewPending: boolean;
  readonly onSelect: (areaId: string) => void;
  readonly onHideAnswer: () => void;
}) {
  const selectArea = () => {
    onSelect(area.id);
    onHideAnswer();
  };
  return (
    <Pressable
      disabled={reviewPending}
      accessibilityState={{ disabled: reviewPending }}
      onPress={selectArea}
      className="flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
    >
      <View
        className="h-[35px] w-[5px] rounded-[4px] mr-[12px]"
        style={[{ backgroundColor: area.color }]}
      />
      <View className="flex-1">
        <Text className="text-recall-ink text-[13px] font-semibold">{area.title}</Text>
        <Text className="text-recall-muted text-[10px] mt-[3px]">{area.cards.length} cards</Text>
      </View>
      <Text className="text-recall-muted text-[10px] mr-[12px]">{areaDue} due</Text>
      <Text className="text-recall-muted text-[24px] mt-[-3px]">›</Text>
    </Pressable>
  );
}

export function DeckChoiceButton({
  area,
  selected,
  dueCount,
  reviewPending,
  onSelect,
}: {
  readonly area: Area;
  readonly selected: boolean;
  readonly dueCount: number;
  readonly reviewPending: boolean;
  readonly onSelect: (areaId: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: reviewPending }}
      disabled={reviewPending}
      onPress={() => {
        onSelect(area.id);
      }}
      className="flex-row items-center border-t-recall-line border-t py-[12px] justify-between"
    >
      <Text className="text-recall-ink text-[13px] font-semibold">{area.title}</Text>
      <Text className="text-recall-muted text-[10px] mr-[12px]">{dueCount} due</Text>
    </Pressable>
  );
}

export function FlaggedCardsAction({
  area,
  flaggedCardIds,
  onEdit,
}: {
  readonly area: Area;
  readonly flaggedCardIds: readonly string[];
  readonly onEdit: () => void;
}) {
  const count = area.cards.filter((entry) => flaggedCardIds.includes(entry.id)).length;
  if (count === 0) return null;
  return (
    <NativeButton label={`Edit flagged cards (${String(count)})`} tone="soft" onPress={onEdit} />
  );
}

export function DecksSection({
  workspace,
  now,
  reviewPending,
  onSelectArea,
  onHideAnswer,
  onImportAnki,
  onReset,
  canReset,
}: {
  readonly workspace: Workspace;
  readonly now: number;
  readonly reviewPending: boolean;
  readonly onSelectArea: (areaId: string) => void;
  readonly onHideAnswer: () => void;
  readonly onImportAnki: () => void;
  readonly onReset: () => void;
  readonly canReset: boolean;
}) {
  return (
    <View className="mt-[31px]">
      <View className="flex-row justify-between items-center mb-[13px]">
        <Text className="text-recall-ink text-[17px] font-bold tracking-[-0.3px]">Decks</Text>
        <Text className="text-recall-muted text-[9px] font-extrabold tracking-[1.1px]">
          {workspace.areas.length} AREAS
        </Text>
      </View>
      {workspace.areas.map((area) => (
        <DeckListRow
          key={area.id}
          area={area}
          areaDue={area.cards.filter((item) => Date.parse(item.schedule.due) <= now).length}
          reviewPending={reviewPending}
          onSelect={onSelectArea}
          onHideAnswer={onHideAnswer}
        />
      ))}
      <NativeButton
        label="Import Anki deck"
        onPress={onImportAnki}
        tone="soft"
        disabled={reviewPending}
      />
      <NativeButton
        label="Reset local study data"
        onPress={onReset}
        tone="soft"
        disabled={!canReset || reviewPending}
      />
    </View>
  );
}
