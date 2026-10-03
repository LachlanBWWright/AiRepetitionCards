import type { Meta, StoryObj } from "@storybook/react";
import { StyleSheet, Text, View } from "react-native";
import { designTokens } from "@recall/design-tokens";
import { NativeButton, NativeEmptyState, NativeStatusBadge } from "./index";

function NativeCatalog({ state }: { readonly state: "actions" | "empty" | "offline" }) {
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>Recall</Text>
          <NativeStatusBadge label="OFFLINE READY" />
        </View>
        <Text style={styles.heading}>Your study space</Text>
        {state === "empty" ? (
          <NativeEmptyState
            title="You’re all caught up"
            description="There are no cards due in Cell Biology. Come back later for your next review."
          />
        ) : (
          <View style={styles.card}>
            <Text style={styles.title}>
              {state === "offline" ? "Your library is available offline" : "Ready to study"}
            </Text>
            <Text style={styles.description}>
              {state === "offline"
                ? "Cards and review history stay on this device until you choose to sync."
                : "12 cards are due in Cell Biology. Reveal an answer, then rate your recall."}
            </Text>
            <NativeButton label="Show answer" onPress={() => undefined} />
            <NativeButton label="Import Anki deck" tone="soft" onPress={() => undefined} />
            <NativeButton label="Sync unavailable" tone="soft" disabled onPress={() => undefined} />
          </View>
        )}
      </View>
    </View>
  );
}

const meta = {
  title: "Native UI/Primitives",
  component: NativeCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NativeCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;
export const StudyActions: Story = { args: { state: "actions" } };
export const CaughtUp: Story = { args: { state: "empty" } };
export const OfflineLibrary: Story = { args: { state: "offline" } };

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 900, backgroundColor: designTokens.color.paper },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 24, gap: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { color: designTokens.color.ink, fontSize: 24, fontWeight: "700" },
  heading: { color: designTokens.color.ink, fontSize: 32, fontWeight: "700" },
  card: {
    backgroundColor: designTokens.color.surface,
    borderRadius: designTokens.radius.card,
    borderColor: designTokens.color.line,
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  title: { color: designTokens.color.ink, fontSize: 20, fontWeight: "700" },
  description: { color: designTokens.color.muted, fontSize: 14, lineHeight: 22 },
});
