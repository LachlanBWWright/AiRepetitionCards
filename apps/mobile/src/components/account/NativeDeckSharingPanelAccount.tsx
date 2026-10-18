import { Text, View } from "react-native";
import type { DeckSubscription, DeckSubscriptionUpdate, DeckSummary } from "@recall/contracts";
import { NativeButton } from "../ui/NativeButton";

type NativeDeckSharingPanelAccountProps = {
  readonly section: "updates" | "management";
  readonly accountId: string | null;
  readonly busy: boolean;
  readonly updates: readonly DeckSubscriptionUpdate[];
  readonly mine: readonly DeckSummary[];
  readonly subscriptions: readonly DeckSubscription[];
  readonly onReviewVersion?: (versionId: string) => void;
  readonly onMarkUpdateRead?: (areaId: string, versionId: string) => void;
  readonly onManageDeck?: (deckId: string) => void;
  readonly onUnfollow?: (areaId: string) => void;
};

type NativeDeckSharingUpdateRowProps = {
  readonly update: DeckSubscriptionUpdate;
  readonly busy: boolean;
  readonly onReviewVersion: ((versionId: string) => void) | undefined;
  readonly onMarkUpdateRead: ((areaId: string, versionId: string) => void) | undefined;
};

function NativeDeckSharingUpdateRow({
  update,
  busy,
  onReviewVersion,
  onMarkUpdateRead,
}: NativeDeckSharingUpdateRowProps) {
  return (
    <View className="gap-2 border-t border-recall-line pt-3">
      <Text className="font-medium">
        {update.title} · v{update.latestVersion}
      </Text>
      {update.releaseNotes ? <Text className="text-sm">{update.releaseNotes}</Text> : null}
      <Text className="text-xs text-recall-muted">
        {update.seen ? "Reviewed" : "New release"} ·{" "}
        {new Date(update.createdAt).toLocaleDateString()}
      </Text>
      <NativeButton
        label="Review exact public version"
        tone="soft"
        disabled={busy}
        onPress={() => onReviewVersion?.(update.latestVersionId)}
      />
      {!update.seen ? (
        <NativeButton
          label="Mark as reviewed"
          tone="soft"
          disabled={busy}
          onPress={() => onMarkUpdateRead?.(update.areaId, update.latestVersionId)}
        />
      ) : null}
    </View>
  );
}

export function NativeDeckSharingPanelAccount({
  section,
  accountId,
  busy,
  updates,
  mine,
  subscriptions,
  onReviewVersion,
  onMarkUpdateRead,
  onManageDeck,
  onUnfollow,
}: NativeDeckSharingPanelAccountProps) {
  return (
    <>
      {section === "updates" && accountId ? (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <Text className="font-semibold">Followed deck updates</Text>
          {updates.length === 0 ? (
            <Text className="text-sm text-recall-muted">No new public releases.</Text>
          ) : (
            updates.map((update) => (
              <NativeDeckSharingUpdateRow
                key={`${update.areaId}:${update.latestVersionId}`}
                update={update}
                busy={busy}
                onReviewVersion={onReviewVersion}
                onMarkUpdateRead={onMarkUpdateRead}
              />
            ))
          )}
        </View>
      ) : null}
      {section === "management" && accountId ? (
        <View className="gap-3 border-t border-recall-line pt-4">
          <Text className="font-bold">My shared decks</Text>
          {mine.map((deck) => (
            <View key={deck.id} className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm">
                {deck.title} · {deck.status} · v{deck.version}
              </Text>
              <NativeButton
                label="Manage"
                tone="soft"
                disabled={busy}
                onPress={() => onManageDeck?.(deck.id)}
              />
            </View>
          ))}
          <Text className="font-bold">Following</Text>
          {subscriptions.map((item) => (
            <View key={item.areaId} className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm">
                {mine.find((deck) => deck.id === item.deckId)?.title ?? "Shared deck"} ·{" "}
                {item.following ? "following" : "paused"}
              </Text>
              <NativeButton
                label="Unfollow"
                tone="soft"
                disabled={busy}
                onPress={() => onUnfollow?.(item.areaId)}
              />
            </View>
          ))}
        </View>
      ) : null}
      {section === "management" && !accountId ? (
        <Text className="text-sm text-recall-muted">
          Sign in to manage shared decks and subscriptions.
        </Text>
      ) : null}
    </>
  );
}
