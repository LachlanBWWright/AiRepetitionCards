import { Pressable, Text, View } from "react-native";
import type { KnowledgeAreaDiff } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { NativeDeckUpdatePanel } from "./updates/NativeDeckUpdatePanel";
import { NativeDeckVersionSamples } from "./updates/NativeDeckVersionSamples";
import { NativePublishingPanelReceiveComparison } from "./NativePublishingPanel.ReceiveComparison";
import type {
  NativePublishingPanelProps,
  NativePublishingPanelPublication,
} from "./NativePublishingPanel.types";

type NativePublishingPanelReceiveDetailsProps = {
  readonly publication: NativePublishingPanelPublication | null;
  readonly comparison: KnowledgeAreaDiff | null;
  readonly comparisonFailed: boolean;
  readonly area: KnowledgeArea | null;
  readonly clients: NonNullable<NativePublishingPanelProps["clients"]>;
  readonly createForkOperationId: () => string;
  readonly onUpdate: NativePublishingPanelProps["onUpdate"];
  readonly busy: boolean;
  readonly onFork: () => void;
};

export function NativePublishingPanelReceiveDetails({
  publication,
  comparison,
  comparisonFailed,
  area,
  clients,
  createForkOperationId,
  onUpdate,
  busy,
  onFork,
}: NativePublishingPanelReceiveDetailsProps) {
  if (!publication) return null;
  return (
    <View className={"gap-[10px] py-[14px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
        {publication.document.title}
      </Text>
      {publication.document.description ? (
        <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
          {publication.document.description}
        </Text>
      ) : null}
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Attribution: {publication.attribution || "Not provided"} · License:{" "}
        {publication.license || "Not provided"}
      </Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        {publication.document.cards.length} cards
      </Text>
      <NativeDeckVersionSamples cards={publication.document.cards} />
      <NativePublishingPanelReceiveComparison
        comparison={comparison}
        comparisonFailed={comparisonFailed}
      />
      {onUpdate &&
      area?.sourceId === publication.document.id &&
      area.forkedFromVersionId !== publication.versionId ? (
        <NativeDeckUpdatePanel
          key={`${area.id}:${String(area.forkedFromVersionId)}:${publication.versionId}:${JSON.stringify(area)}`}
          current={area}
          upstream={publication.document}
          versionId={publication.versionId}
          {...(publication.token ? { token: publication.token } : {})}
          publishing={clients.publishing}
          media={clients.media}
          createId={createForkOperationId}
          onSave={onUpdate}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          onFork();
        }}
        className={
          "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
        }
      >
        <Text className={"text-recall-surface font-bold text-[12px]"}>Add a personal copy</Text>
      </Pressable>
    </View>
  );
}
