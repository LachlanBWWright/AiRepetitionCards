import type { Assessment, Workspace } from "@recall/domain";
import { NativeButton, NativeCollapsible } from "@recall/ui-native";
import { Text, View } from "react-native";
import { useState } from "react";

export function NativeManualBurialControls({
  workspace,
  card,
  disabled,
  onBury,
  onUnbury,
  onInteractionChange,
  now,
}: {
  readonly workspace: Workspace;
  readonly card: Assessment | undefined;
  readonly disabled: boolean;
  readonly onBury: (id: Assessment["id"], scope: "card" | "note", now: number) => void;
  readonly onUnbury: () => void;
  readonly onInteractionChange?: ((open: boolean) => void) | undefined;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const buried = Object.values(workspace.schedulerSettings?.manualBurials ?? {}).some(
    (until) => until > now,
  );
  if (!card && !buried) return null;
  return (
    <View className="gap-2">
      {card && (
        <NativeCollapsible
          title="Bury until tomorrow"
          open={open}
          onToggle={() => {
            setOpen(!open);
            onInteractionChange?.(!open);
          }}
          disabled={disabled}
        >
          <Text className="text-recall-muted text-sm">
            Return at the next study day without changing the schedule.
          </Text>
          <NativeButton
            variant="secondary"
            disabled={disabled}
            label="Bury this card"
            onPress={() => {
              onBury(card.id, "card", Date.now());
              setOpen(false);
              onInteractionChange?.(false);
            }}
          />
          <NativeButton
            variant="secondary"
            disabled={disabled}
            label="Bury this note and its cards"
            onPress={() => {
              onBury(card.id, "note", Date.now());
              setOpen(false);
              onInteractionChange?.(false);
            }}
          />
        </NativeCollapsible>
      )}
      {buried && (
        <NativeButton
          variant="secondary"
          disabled={disabled}
          label="Unbury cards"
          onPress={onUnbury}
        />
      )}
    </View>
  );
}
