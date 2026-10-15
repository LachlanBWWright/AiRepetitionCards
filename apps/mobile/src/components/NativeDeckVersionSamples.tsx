import { useState } from "react";
import { Effect, Either } from "effect";
import { expandCloze } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { Text, View } from "react-native";
import { NativeButton } from "./ui/NativeButton";

export function NativeDeckVersionSamples({ cards }: { readonly cards: KnowledgeArea["cards"] }) {
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  const samples = cards.slice(0, 5);
  if (samples.length === 0) return null;

  return (
    <View className="gap-3 rounded-xl border border-recall-line p-3">
      <Text className="font-semibold">Card samples</Text>
      {samples.map((card, index) => {
        const cloze =
          card.kind === "cloze"
            ? Effect.runSync(Effect.either(expandCloze(card.text, card.deletionIndex)))
            : null;
        const renderedCloze = cloze && Either.isRight(cloze) ? cloze.right[0] : undefined;
        const prompt = card.kind === "basic" ? card.front : (renderedCloze?.front ?? card.text);
        const answer = card.kind === "basic" ? card.back : renderedCloze?.back;
        const revealed = revealedIds.has(card.id);
        return (
          <View key={`${card.id}:${index}`} className="gap-2 rounded-lg bg-recall-muted/10 p-3">
            <Text className="text-xs font-semibold uppercase text-recall-muted">
              {card.kind === "basic" ? "Basic card" : "Cloze card"}
            </Text>
            <Text className="text-sm">{prompt}</Text>
            {revealed ? (
              <Text className="text-sm font-semibold">
                {answer ?? "The answer could not be rendered."}
              </Text>
            ) : null}
            <NativeButton
              label={revealed ? "Hide answer" : "Reveal answer"}
              tone="soft"
              onPress={() =>
                setRevealedIds((current) => {
                  const next = new Set(current);
                  if (revealed) next.delete(card.id);
                  else next.add(card.id);
                  return next;
                })
              }
            />
          </View>
        );
      })}
    </View>
  );
}
