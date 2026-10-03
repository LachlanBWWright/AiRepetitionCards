import { Pressable, StyleSheet, Text } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { designTokens } from "@recall/design-tokens";

export type NativeButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "dark" | "soft";
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly labelStyle?: StyleProp<TextStyle>;
};

export function NativeButton({
  label,
  onPress,
  tone = "dark",
  disabled = false,
  style,
  labelStyle,
}: NativeButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "dark" ? styles.dark : styles.soft,
        style,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.label, tone === "soft" && styles.softLabel, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const palette = designTokens.color;
const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: designTokens.spacing.md,
    borderRadius: 15,
  },
  dark: { backgroundColor: palette.ink },
  soft: { backgroundColor: "#f0efe9", marginTop: 8 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  label: { color: palette.surface, fontSize: 13, fontWeight: "700" },
  softLabel: { color: palette.ink },
});
