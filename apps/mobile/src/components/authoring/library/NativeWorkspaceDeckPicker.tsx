import { summarizeStudySession } from "@recall/application";
import type { Workspace } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";

type DeckSummary = ReturnType<typeof summarizeStudySession>;

function DeckRow({
  deck,
  summary,
  locked,
  onSelect,
  onStudy,
  onRetainCurrentDraft,
}: {
  readonly deck: Workspace["areas"][number];
  readonly summary: DeckSummary;
  readonly locked: boolean;
  readonly onSelect: (id: string) => void;
  readonly onStudy: ((areaId: string) => void) | undefined;
  readonly onRetainCurrentDraft: () => void;
}) {
  return (
    <View className="gap-2 rounded-xl border border-recall-line p-4">
      <Text className="text-base font-bold">{deck.title}</Text>
      <Text className="text-sm text-recall-muted">
        {deck.cards.length} {deck.cards.length === 1 ? "card" : "cards"} · {summary.remaining} due
      </Text>
      <Text className="text-sm text-recall-muted">
        {summary.remaining
          ? "Ready to review"
          : summary.nextReviewAt
            ? `Next review: ${new Date(summary.nextReviewAt).toLocaleString()}`
            : "Add cards to get started"}
      </Text>
      <NativeButton
        label="Open subject"
        tone="soft"
        disabled={locked}
        onPress={() => {
          onRetainCurrentDraft();
          onSelect(deck.id);
        }}
      />
      {onStudy && (
        <NativeButton
          label={`Review ${String(summary.remaining)} due`}
          disabled={locked || summary.remaining === 0}
          onPress={() => {
            onRetainCurrentDraft();
            onStudy(deck.id);
          }}
        />
      )}
    </View>
  );
}

type Props = {
  readonly locked: boolean;
  readonly workspace: Workspace | null;
  readonly now: number;
  readonly onSelectDeck: ((id: string) => void) | undefined;
  readonly onStudy: ((areaId: string) => void) | undefined;
  readonly onRetainCurrentDraft: () => void;
};
export function NativeWorkspaceDeckPicker({
  locked,
  workspace,
  now,
  onSelectDeck,
  onStudy,
  onRetainCurrentDraft,
}: Props) {
  return (
    <>
      {onSelectDeck && workspace && (
        <View className="gap-3">
          <Text className="text-lg font-bold">Your decks</Text>
          {workspace.areas.map((deck) => (
            <DeckRow
              key={deck.id}
              deck={deck}
              summary={summarizeStudySession(deck, [], now)}
              locked={locked}
              onSelect={onSelectDeck}
              onStudy={onStudy}
              onRetainCurrentDraft={onRetainCurrentDraft}
            />
          ))}
        </View>
      )}
    </>
  );
}
