import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { designTokens } from "@recall/design-tokens";

export function NativeStatusBadge({
  label,
  style,
}: {
  readonly label: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, style]}>
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const palette = designTokens.color;
const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: designTokens.radius.pill,
    paddingVertical: designTokens.spacing.xs,
    paddingHorizontal: 11,
  },
  dot: { height: 7, width: 7, borderRadius: 4, backgroundColor: palette.darkGreen },
  label: { fontSize: 9, color: palette.muted, fontWeight: "800", letterSpacing: 0.8 },
});
