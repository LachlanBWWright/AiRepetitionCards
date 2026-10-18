import { Pressable, Text, TextInput } from "react-native";
import { designTokens } from "@recall/design-tokens";
import type {
  NativePublishingPanelProps,
  NativePublishingPanelPublication,
} from "./NativePublishingPanel.types";
import type { KnowledgeAreaDiff } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { NativePublishingPanelReceiveDetails } from "./NativePublishingPanel.ReceiveDetails";

type NativePublishingPanelReceiveProps = {
  readonly mode: "publish" | "receive";
  readonly versionId: string;
  readonly token: string;
  readonly busy: boolean;
  readonly publication: NativePublishingPanelPublication | null;
  readonly comparison: KnowledgeAreaDiff | null;
  readonly comparisonFailed: boolean;
  readonly area: KnowledgeArea | null;
  readonly clients: NonNullable<NativePublishingPanelProps["clients"]>;
  readonly createForkOperationId: () => string;
  readonly onUpdate: NativePublishingPanelProps["onUpdate"];
  readonly onVersionIdChange: (value: string) => void;
  readonly onTokenChange: (value: string) => void;
  readonly onReceive: () => void;
  readonly onFork: () => void;
};

export function NativePublishingPanelReceive(props: NativePublishingPanelReceiveProps) {
  const {
    mode,
    versionId,
    token,
    busy,
    publication,
    comparison,
    comparisonFailed,
    area,
    clients,
    createForkOperationId,
    onUpdate,
    onVersionIdChange,
    onTokenChange,
    onReceive,
    onFork,
  } = props;
  const palette = designTokens.color;
  return (
    <>
      {mode === "receive" && (
        <>
          <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>Receive an area</Text>
          <TextInput
            accessibilityLabel="Publication version ID"
            autoCapitalize="none"
            onChangeText={onVersionIdChange}
            placeholder="Paste a version ID"
            placeholderTextColor={palette.muted}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={versionId}
          />
          <TextInput
            accessibilityLabel="Share token"
            autoCapitalize="none"
            onChangeText={onTokenChange}
            placeholder="Share token, if required"
            placeholderTextColor={palette.muted}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={token}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !versionId.trim()}
            onPress={() => {
              onReceive();
            }}
            className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
          >
            <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
              Preview shared area
            </Text>
          </Pressable>
          <NativePublishingPanelReceiveDetails
            publication={publication}
            comparison={comparison}
            comparisonFailed={comparisonFailed}
            area={area}
            clients={clients}
            createForkOperationId={createForkOperationId}
            onUpdate={onUpdate}
            busy={busy}
            onFork={onFork}
          />
        </>
      )}
    </>
  );
}
