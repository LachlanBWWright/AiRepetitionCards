import { Text, View } from "react-native";
import type { DeckSubscription, DeckSubscriptionUpdate, DeckSummary } from "@recall/contracts";
import { NativeButton } from "../ui/NativeButton";
import { NativeTextField } from "../ui/NativeTextField";
import { NativeDeckSharingPanelAccount } from "../account/NativeDeckSharingPanelAccount";

type NativeDeckSharingPanelManagementProps = {
  readonly deck: DeckSummary;
  readonly accountId: string | null;
  readonly busy: boolean;
  readonly title: string;
  readonly onTitleChange: (value: string) => void;
  readonly description: string;
  readonly onDescriptionChange: (value: string) => void;
  readonly onSaveMetadata: () => void;
  readonly onWithdraw: () => void;
  readonly updates: readonly DeckSubscriptionUpdate[];
  readonly mine: readonly DeckSummary[];
  readonly subscriptions: readonly DeckSubscription[];
  readonly onReviewVersion: (versionId: string, token?: string) => void;
  readonly onManageDeck: (deckId: string) => void;
  readonly onUnfollow: (areaId: string) => void;
};

export function NativeDeckSharingPanelManagement({
  deck,
  accountId,
  busy,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  onSaveMetadata,
  onWithdraw,
  updates,
  mine,
  subscriptions,
  onReviewVersion,
  onManageDeck,
  onUnfollow,
}: NativeDeckSharingPanelManagementProps) {
  return (
    <View className="gap-3 rounded-xl bg-recall-muted/10 p-3">
      <Text className="font-semibold">Manage shared deck</Text>
      <NativeTextField label="Title" value={title} onChangeText={onTitleChange} maxLength={300} />
      <NativeTextField
        label="Description"
        value={description}
        onChangeText={onDescriptionChange}
        maxLength={4000}
        multiline
      />
      <NativeButton label="Save metadata" tone="soft" disabled={busy} onPress={onSaveMetadata} />
      {deck.status === "active" ? (
        <NativeButton label="Withdraw deck" tone="soft" disabled={busy} onPress={onWithdraw} />
      ) : null}
      <NativeDeckSharingPanelAccount
        section="management"
        accountId={accountId}
        busy={busy}
        updates={updates}
        mine={mine}
        subscriptions={subscriptions}
        onReviewVersion={onReviewVersion}
        onManageDeck={onManageDeck}
        onUnfollow={onUnfollow}
      />
    </View>
  );
}
