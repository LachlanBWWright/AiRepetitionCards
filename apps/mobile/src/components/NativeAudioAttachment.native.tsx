import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { designTokens } from "@recall/design-tokens";

const palette = designTokens.color;

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
      style={styles.attachment}
    >
      <Text style={styles.label}>{playing ? "Ⅱ  Pause audio" : "▶  Play audio"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  attachment: { borderRadius: 12, backgroundColor: palette.green, padding: 14, marginVertical: 14 },
  label: { color: palette.darkGreen, fontSize: 12, fontWeight: "700" },
});
