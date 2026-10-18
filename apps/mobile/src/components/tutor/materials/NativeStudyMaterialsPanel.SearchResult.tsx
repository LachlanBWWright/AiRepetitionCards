import { Text, View } from "react-native";

export function NativeStudyMaterialsPanelSearchResult({
  materialName,
  passageTitle,
  passageText,
  claimTitle,
}: {
  readonly materialName: string;
  readonly passageTitle: string | null;
  readonly passageText: string | null;
  readonly claimTitle: string | null;
}) {
  return (
    <View accessibilityLiveRegion="polite" className="gap-[8px]">
      <Text className="text-recall-ink text-[14px] font-bold">{materialName}</Text>
      {passageTitle !== null ? (
        <Text className="text-recall-ink text-[12px] leading-[18px]">{passageTitle}</Text>
      ) : null}
      {passageText !== null ? (
        <Text className="text-recall-ink text-[12px] leading-[18px]">{passageText}</Text>
      ) : null}
      {claimTitle !== null ? (
        <Text className="text-recall-ink text-[12px] leading-[18px]">{claimTitle}</Text>
      ) : null}
    </View>
  );
}
