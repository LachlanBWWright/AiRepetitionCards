import type { DeckSubscription } from "@recall/contracts";
import type { DeckVersionSummary } from "@recall/contracts";
import { NativeSelect } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";

type NativeDeckSharingPanelVersionActionsProps = {
  readonly deckId: string;
  readonly versions: readonly DeckVersionSummary[];
  readonly accountId: string | null;
  readonly currentArea: {
    readonly id: string;
    readonly title: string;
    readonly sourceId?: string;
    readonly sourceVersionId?: string;
  } | null;
  readonly busy: boolean;
  readonly selectedVersion: string;
  readonly onSelectedVersionChange: (value: string) => void;
  readonly accessToken: string;
  readonly subscriptions: readonly DeckSubscription[];
  readonly onReviewVersion: (versionId: string, token?: string) => void;
  readonly onFollowVersion: (versionId: string, following: boolean) => void;
};

export function NativeDeckSharingPanelVersionActions({
  deckId,
  versions,
  accountId,
  currentArea,
  busy,
  selectedVersion,
  onSelectedVersionChange,
  accessToken,
  subscriptions,
  onReviewVersion,
  onFollowVersion,
}: NativeDeckSharingPanelVersionActionsProps) {
  const options = versions.map((version) => ({
    label: `Version ${String(version.version)} · ${new Date(version.createdAt).toLocaleDateString()}`,
    value: version.id,
  }));
  const isFollowing = subscriptions.some(
    (item) => item.deckId === deckId && item.areaId === currentArea?.id && item.following,
  );

  return (
    <>
      {options.length ? (
        <NativeSelect
          label="Deck version"
          value={selectedVersion}
          options={options}
          onValueChange={onSelectedVersionChange}
          disabled={busy}
        />
      ) : null}
      <NativeButton
        label="Review selected version"
        disabled={busy || !selectedVersion}
        onPress={() => {
          onReviewVersion(selectedVersion, accessToken.trim() || undefined);
        }}
      />
      {accountId && currentArea && currentArea.sourceId === deckId ? (
        <NativeButton
          label={
            isFollowing
              ? `Following in ${currentArea.title}`
              : `Follow updates in ${currentArea.title}`
          }
          tone="soft"
          disabled={busy || !currentArea.sourceVersionId}
          onPress={() => {
            onFollowVersion(currentArea.sourceVersionId ?? "", !isFollowing);
          }}
        />
      ) : null}
    </>
  );
}
