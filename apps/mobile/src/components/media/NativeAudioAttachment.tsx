import { Text, View } from "react-native";

export function NativeAudioAttachment({ uri }: { readonly uri: string }) {
  return (
    <View
      accessibilityLabel={uri.length ? "Audio attachment" : "No audio attached"}
      className={"rounded-[12px] bg-recall-green p-[14px] my-[14px]"}
    >
      <Text className={"text-recall-darkGreen text-[12px] font-bold"}>
        {uri.length ? "Audio attachment" : "No audio attached"}
      </Text>
    </View>
  );
}
