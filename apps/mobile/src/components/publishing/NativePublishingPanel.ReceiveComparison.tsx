import { Text, View } from "react-native";
import type { KnowledgeAreaDiff } from "@recall/application";

type NativePublishingPanelReceiveComparisonProps = {
  readonly comparison: KnowledgeAreaDiff | null;
  readonly comparisonFailed: boolean;
};

export function NativePublishingPanelReceiveComparison({
  comparison,
  comparisonFailed,
}: NativePublishingPanelReceiveComparisonProps) {
  return (
    <>
      {comparison ? (
        <View
          accessibilityLabel="Upstream version comparison"
          className="gap-[6px] py-[10px] border-t border-recall-line"
        >
          <Text className="text-recall-ink text-[14px] font-bold mt-[4px]">
            Changes from your copy
          </Text>
          <Text className="text-recall-muted text-[12px] leading-[18px]">
            Cards: +{comparison.cards.added.length} · ~{comparison.cards.changed.length} · −
            {comparison.cards.removed.length}
          </Text>
          <Text className="text-recall-muted text-[12px] leading-[18px]">
            Objectives: +{comparison.objectives.added.length} · ~
            {comparison.objectives.changed.length} · −{comparison.objectives.removed.length}
          </Text>
          {comparison.metadata.length > 0 ? (
            <Text className="text-recall-muted text-[12px] leading-[18px]">
              Changed details: {comparison.metadata.map(({ field }) => field).join(", ")}
            </Text>
          ) : null}
          <Text className="text-recall-muted text-[12px] leading-[18px]">
            Counts include edits made to your copy.
          </Text>
        </View>
      ) : null}
      {comparisonFailed ? (
        <Text accessibilityRole="alert" className="text-recall-muted text-[12px] leading-[18px]">
          The shared version loaded, but its differences could not be compared.
        </Text>
      ) : null}
    </>
  );
}
