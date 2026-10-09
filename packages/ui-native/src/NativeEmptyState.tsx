import { Text, View } from "react-native";

export function NativeEmptyState({
  title,
  description,
  glyph = "✓",
}: {
  readonly title: string;
  readonly description: string;
  readonly glyph?: string;
}) {
  return (
    <View className="min-h-[240px] mt-[30px] items-center justify-center rounded-[12px] border border-recall-line bg-recall-surface p-7">
      <View className="h-[42px] w-[42px] rounded-[21px] bg-recall-green items-center justify-center mb-[14px]">
        <Text className="text-[22px] text-recall-darkGreen font-extrabold">{glyph}</Text>
      </View>
      <Text className="text-recall-ink text-[19px] font-bold">{title}</Text>
      <Text className="text-recall-muted text-[13px] leading-[20px] text-center mt-2 max-w-[300px]">
        {description}
      </Text>
    </View>
  );
}
