import { Text, View } from "react-native";
import type { DeckSummary } from "@recall/contracts";

type NativeDeckSharingPanelOverviewProps = {
  readonly deck: DeckSummary;
};

export function NativeDeckSharingPanelOverview({ deck }: NativeDeckSharingPanelOverviewProps) {
  return (
    <>
      <Text className="text-base font-bold">{deck.title}</Text>
      <Text className="text-sm text-recall-muted">
        {deck.visibility} · {deck.status} · {deck.cardCount} cards
      </Text>
      {deck.catalog ? (
        <View className="gap-2 rounded-lg bg-recall-muted/10 p-3">
          <Text className="text-sm">
            {deck.catalog.difficulty ?? "Difficulty unspecified"} · about{" "}
            {deck.catalog.estimatedMinutes} minutes
          </Text>
          <Text className="text-xs text-recall-muted">
            Duration estimate uses published card and activity counts.
          </Text>
          {deck.catalog.preview.map((card, index) => (
            <Text
              key={`${String(index)}-${card.prompt}`}
              className="border-t border-recall-line pt-2 text-xs"
            >
              {card.prompt}
              {card.answer ? ` → ${card.answer}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}
