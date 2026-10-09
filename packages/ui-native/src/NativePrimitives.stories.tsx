import type { Meta, StoryObj } from "@storybook/react";
import { Text, View } from "react-native";
import { NativeButton } from "./NativeButton";

function NativeCatalog({ state }: { readonly state: "actions" | "empty" | "offline" }) {
  return (
    <View className="flex-1 min-h-[900px] bg-recall-paper">
      <View className="w-full max-w-[720px] self-center p-6 gap-6">
        <Text className="text-recall-ink text-[32px] font-bold">Today</Text>
        {state === "empty" ? (
          <Text className="text-recall-muted text-[14px] leading-[22px]">No cards due</Text>
        ) : (
          <View className="bg-recall-surface rounded-recall-card border border-recall-line p-6 gap-3">
            <Text className="text-recall-ink text-[20px] font-bold">
              {state === "offline" ? "Library available" : "Ready to study"}
            </Text>
            <Text className="text-recall-muted text-[14px] leading-[22px]">
              {state === "offline"
                ? "Cards and review history stay on this device until you choose to sync."
                : "12 cards are due. Reveal an answer, then rate your recall."}
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
