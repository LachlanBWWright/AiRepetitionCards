import { StyleSheet, Text, View } from "react-native";
import { designTokens } from "@recall/design-tokens";

const palette = designTokens.color;

export function NativeAudioAttachment({ uri }: { readonly uri: string }) {
  return (
    <View
      accessibilityLabel={uri.length ? "Audio attachment" : "No audio attached"}
      style={styles.attachment}
    >
      <Text style={styles.label}>{uri.length ? "Audio attachment" : "No audio attached"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  attachment: { borderRadius: 12, backgroundColor: palette.green, padding: 14, marginVertical: 14 },
  label: { color: palette.darkGreen, fontSize: 12, fontWeight: "700" },
});
