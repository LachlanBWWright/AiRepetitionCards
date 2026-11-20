import { NativeButton } from "@recall/ui-native";

import { useState } from "react";

import { useAudioPlayer } from "expo-audio";

export function NativeAudioAttachment({ uri }: { readonly uri: string }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(false);
  return (
    <NativeButton
      label={playing ? "Ⅱ  Pause audio" : "▶  Play audio"}
      variant="default"
      accessibilityLabel={playing ? "Pause audio attachment" : "Play audio attachment"}
      onPress={() => {
        if (playing) player.pause();
        else player.play();
        setPlaying(!playing);
      }}
    />
  );
}
