import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
import type { CardProposal } from "@recall/ai-core";
export function NativeProposedCardPreview({
  proposal,
  disabled,
  acceptDisabled,
  onAccept,
  onEdit,
  onDiscard,
  children,
}: {
  readonly proposal: CardProposal;
  readonly disabled: boolean;
  readonly acceptDisabled: boolean;
  readonly onAccept: () => void;
  readonly onEdit: () => void;
  readonly onDiscard: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <View className="overflow-hidden rounded-xl border border-recall-line bg-recall-surface">
      <View className="gap-3 p-4">
        <Text className="text-xs text-recall-muted">Suggested card</Text>
        <Text className="text-base font-semibold leading-6 text-recall-ink">{proposal.front}</Text>
        <Text className="border-t border-recall-line pt-3 text-sm leading-6 text-recall-muted">
          {proposal.back}
        </Text>
        {children}
      </View>
      <View className="flex-row flex-wrap gap-2 border-t border-recall-line p-3">
        <NativeButton label="Add card" disabled={acceptDisabled} onPress={onAccept} />
        <NativeButton label="Edit" tone="soft" disabled={disabled} onPress={onEdit} />
        <NativeButton label="Discard" tone="soft" disabled={disabled} onPress={onDiscard} />
      </View>
    </View>
  );
}
