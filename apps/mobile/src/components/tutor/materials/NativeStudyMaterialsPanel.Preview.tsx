import { ScrollView, Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import type { NativeStudyMaterialsExtraction } from "./NativeStudyMaterialsPanel.intake";

export function NativeStudyMaterialsPanelPreview({
  name,
  extraction,
  onImport,
  onCancel,
}: {
  readonly name: string;
  readonly extraction: NativeStudyMaterialsExtraction;
  readonly onImport: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <View className="gap-[8px]">
      <Text className="text-recall-ink text-[14px] font-bold">Check text · {name}</Text>
      {extraction.warnings.map((warning, index) => (
        <Text key={index} className="text-recall-muted text-[11px] leading-[16px]">
          {warning}
        </Text>
      ))}
      <ScrollView className="max-h-[250px]">
        {extraction.sections.map((item, index) => (
          <View key={index}>
            <Text className="text-recall-ink text-[14px] font-bold">
              {item.title}
              {item.pageNumber ? ` · page ${String(item.pageNumber)}` : ""}
            </Text>
            <Text selectable className="text-recall-ink text-[12px] leading-[18px]">
              {item.text}
            </Text>
          </View>
        ))}
      </ScrollView>
      <NativeButton
        label="Keep material"
        onPress={onImport}
        className="py-[10px] px-[4px]"
        labelClassName="text-recall-surface text-[12px] font-bold"
      />
      <NativeButton
        label="Cancel"
        onPress={onCancel}
        className="py-[10px] px-[4px]"
        labelClassName="text-recall-surface text-[12px] font-bold"
      />
    </View>
  );
}
