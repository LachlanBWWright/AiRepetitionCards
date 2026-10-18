import type { LearningArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

export function NativeWorkspaceFlaggedFilter({
  area,
  flaggedCardIds,
  flaggedOnly,
  onChange,
}: {
  readonly area: LearningArea;
  readonly flaggedCardIds: readonly string[];
  readonly flaggedOnly: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const flaggedCount = area.cards.filter((card) => flaggedCardIds.includes(card.id)).length;

  return (
    <NativeButton
      label={flaggedOnly ? "Show all cards" : `Flagged for editing (${String(flaggedCount)})`}
      tone="soft"
      onPress={() => {
        onChange(!flaggedOnly);
      }}
    />
  );
}
