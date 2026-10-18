import type { LearningArea } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";

type Props = {
  readonly locked: boolean;
  readonly area: LearningArea | undefined;
  readonly onImportCards: (() => void) | undefined;
  readonly onGenerateCards: (() => void) | undefined;
  readonly creationChoices: boolean;
  readonly setCreationChoices: (value: boolean) => void;
  readonly onCreateArea: () => void;
  readonly onCreateCard: () => void;
};
export function NativeWorkspaceCreation({
  locked,
  area,
  onImportCards,
  onGenerateCards,
  creationChoices,
  setCreationChoices,
  onCreateArea,
  onCreateCard,
}: Props) {
  return (
    <>
      {
        <NativeButton
          label="New subject"
          tone="soft"
          disabled={locked}
          onPress={() => {
            onCreateArea();
          }}
        />
      }
      {onImportCards && (
        <NativeButton label="Import cards" tone="soft" disabled={locked} onPress={onImportCards} />
      )}
      {creationChoices && area && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold text-recall-ink">Add cards to {area.title}</Text>
          <Text className="text-sm text-recall-muted">
            Write cards, generate suggestions from materials, or import an existing deck. AI
            suggestions need your approval.
          </Text>
          <NativeButton
            label="Write manually"
            disabled={locked}
            onPress={() => {
              setCreationChoices(false);
              onCreateCard();
            }}
          />
          {onGenerateCards && (
            <NativeButton
              label="Generate from materials"
              tone="soft"
              disabled={locked}
              onPress={() => {
                setCreationChoices(false);
                onGenerateCards();
              }}
            />
          )}
          {onImportCards && (
            <NativeButton
              label="Import existing cards"
              tone="soft"
              disabled={locked}
              onPress={() => {
                setCreationChoices(false);
                onImportCards();
              }}
            />
          )}
          <NativeButton
            label="Finish later"
            tone="soft"
            disabled={locked}
            onPress={() => {
              setCreationChoices(false);
            }}
          />
        </View>
      )}
    </>
  );
}
