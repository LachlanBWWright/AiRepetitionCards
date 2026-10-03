import { StyleSheet, Text, View } from "react-native";
import { designTokens } from "@recall/design-tokens";

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
    <View style={styles.container}>
      <View style={styles.icon}>
        <Text style={styles.glyph}>{glyph}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const palette = designTokens.color;
const styles = StyleSheet.create({
  container: {
    minHeight: 240,
    marginTop: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    borderColor: palette.line,
    borderWidth: 1,
    backgroundColor: palette.surface,
    padding: 28,
  },
  icon: {
    height: 42,
    width: 42,
    borderRadius: 21,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  glyph: { fontSize: 22, color: palette.darkGreen, fontWeight: "800" },
  title: { color: palette.ink, fontSize: 19, fontWeight: "700" },
  description: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: designTokens.spacing.xs,
    maxWidth: 300,
  },
});
