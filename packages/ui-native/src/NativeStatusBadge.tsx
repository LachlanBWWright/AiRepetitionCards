import { Text, View } from "react-native";

export function NativeStatusBadge({
  label,
  className,
}: {
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <View
      className={`flex-row items-center gap-[7px] border border-recall-line rounded-full py-2 px-[11px] ${className ?? ""}`}
    >
      <View className="h-[7px] w-[7px] rounded-[4px] bg-recall-darkGreen" />
      <Text className="text-[9px] text-recall-muted font-extrabold tracking-[0.8px]">{label}</Text>
    </View>
  );
}
