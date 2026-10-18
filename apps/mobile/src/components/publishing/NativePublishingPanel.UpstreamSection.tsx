import { Pressable, Text, View } from "react-native";
import type { KnowledgeArea } from "@recall/domain";
import type { NativePublishingPanelUpstreamUpdateState } from "./NativePublishingPanel.types";

type NativePublishingPanelUpstreamSectionProps = {
  readonly upstreamArea: KnowledgeArea | null;
  readonly upstreamUpdate: NativePublishingPanelUpstreamUpdateState | null;
  readonly busy: boolean;
  readonly onCheckUpdates: () => void;
  readonly onReviewVersion: (versionId: string) => void;
};

export function NativePublishingPanelUpstreamSection({
  upstreamArea,
  upstreamUpdate,
  busy,
  onCheckUpdates,
  onReviewVersion,
}: NativePublishingPanelUpstreamSectionProps) {
  if (!upstreamArea) return null;
  return (
    <View
      className={"gap-[10px] py-[14px] border-t border-recall-line"}
      accessibilityLabel="Upstream updates"
    >
      <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>Updates to your copy</Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Review a newer version before adding it as a separate copy.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onCheckUpdates}
        className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
      >
        <Text className={"text-recall-darkGreen font-bold text-[12px]"}>Check for updates</Text>
      </Pressable>
      {upstreamUpdate && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-recall-muted text-[12px] leading-[18px]"}
        >
          {upstreamUpdate.status === "available"
            ? "A newer public version is available. Review its differences before adding a separate copy."
            : upstreamUpdate.status === "no-public-update"
              ? "No newer public version is available."
              : upstreamUpdate.status === "unavailable"
                ? "No accessible public source is available. Ask the author for a share link to review another version."
                : "Updates could not be checked. Try again when connected."}
        </Text>
      )}
      {upstreamUpdate?.status === "available" && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            onReviewVersion(upstreamUpdate.versionId);
          }}
          className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
        >
          <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
            Review available version
          </Text>
        </Pressable>
      )}
    </View>
  );
}
