import { useState } from "react";
import { Pressable, Text } from "react-native";
import { useAudioPlayer } from "expo-audio";

export function NativeAudioAttachment({ uri }: { readonly uri: string }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause audio attachment" : "Play audio attachment"}
      onPress={() => {
        if (playing) player.pause();
        else player.play();
        setPlaying(!playing);
      }}
      className={"rounded-[12px] bg-recall-green p-[14px] my-[14px]"}
    >
      <Text className={"text-recall-darkGreen text-[12px] font-bold"}>
        {playing ? "Ⅱ  Pause audio" : "▶  Play audio"}
      </Text>
    </Pressable>
  );
}
