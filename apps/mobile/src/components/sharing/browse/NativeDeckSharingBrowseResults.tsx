import { Text, View } from "react-native";
import type { DeckSummary } from "@recall/contracts";
import { NativeButton } from "../../ui/NativeButton";

type Props = {
  readonly decks: readonly DeckSummary[];
  readonly nextCursor: string | null;
  readonly busy: boolean;
  readonly onSearch: (cursor: string | null) => void;
  readonly onOpenDeck: (deckId: string) => void;
};

export function NativeDeckSharingBrowseResults({
  decks,
  nextCursor,
  busy,
  onSearch,
  onOpenDeck,
}: Props) {
  return (
    <>
      {decks.map((deck) => (
        <View key={deck.id} className="gap-2 rounded-xl border border-recall-line p-3">
          <Text className="font-semibold">{deck.title}</Text>
          <Text className="text-sm text-recall-muted">
            {deck.authorName || "Community"} · {deck.language || "Language unspecified"} ·{" "}
            {deck.cardCount} cards · v{deck.version}
          </Text>
          <Text className="text-sm">{deck.description}</Text>
          {deck.catalog ? (
            <Text className="text-xs text-recall-muted">
              {deck.catalog.difficulty ?? "Difficulty unspecified"} · about{" "}
              {deck.catalog.estimatedMinutes} minutes
              {deck.catalog.preview[0]
                ? ` · Preview: ${deck.catalog.preview[0].prompt}${deck.catalog.preview[0].answer ? ` → ${deck.catalog.preview[0].answer}` : ""}`
                : ""}
            </Text>
          ) : null}
          <NativeButton
            label="View deck and versions"
            tone="soft"
            disabled={busy}
            onPress={() => {
              onOpenDeck(deck.id);
            }}
          />
        </View>
      ))}
      {nextCursor ? (
        <NativeButton
          label="Load more decks"
          tone="soft"
          disabled={busy}
          onPress={() => {
            onSearch(nextCursor);
          }}
        />
      ) : null}
    </>
  );
}
