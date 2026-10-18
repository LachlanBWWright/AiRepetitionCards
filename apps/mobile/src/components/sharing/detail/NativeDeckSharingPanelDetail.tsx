import type { ReactNode } from "react";
import { View } from "react-native";
import type { DeckSummary, DeckVersionSummary } from "@recall/contracts";
import { NativeDeckSharingPanelOverview } from "../NativeDeckSharingPanelOverview";

export type NativeDeckSharingPanelDetail = {
  readonly deck: DeckSummary;
  readonly versions: readonly DeckVersionSummary[];
  readonly canManage: boolean;
};

type NativeDeckSharingPanelDetailProps = {
  readonly detail: NativeDeckSharingPanelDetail;
  readonly versionActions?: ReactNode;
  readonly ownerActions?: ReactNode;
  readonly safetyActions?: ReactNode;
};

export function NativeDeckSharingPanelDetail({
  detail,
  versionActions,
  ownerActions,
  safetyActions,
}: NativeDeckSharingPanelDetailProps) {
  return (
    <View className="gap-3 border-t border-recall-line pt-4">
      <NativeDeckSharingPanelOverview deck={detail.deck} />
      {versionActions}
      {ownerActions}
      {safetyActions}
    </View>
  );
}
