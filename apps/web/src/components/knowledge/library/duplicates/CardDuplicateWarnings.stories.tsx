import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { CardDuplicateWarnings } from "./CardDuplicateWarnings";

const meta = {
  title: "Cards/Duplicate review",
  component: CardDuplicateWarnings,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main
        className="mx-auto max-w-5xl space-y-6 p-8"
        style={{ padding: 32, maxWidth: 960, marginInline: "auto" }}
      >
        <Story />
      </main>
    ),
  ],
  args: {
    draft: { front: "What does a Go channel do?", back: "It passes values between goroutines." },
    candidates: [
      {
        id: "go-channel",
        areaId: "go",
        areaTitle: "Go",
        front: "What does a Go channel do?",
        back: "It passes values between goroutines.",
      },
    ],
    keepBoth: false,
    onKeepBothChange: () => undefined,
  },
  render: function Interactive(args) {
    const [keepBoth, setKeepBoth] = useState(false);
    return <CardDuplicateWarnings {...args} keepBoth={keepBoth} onKeepBothChange={setKeepBoth} />;
  },
} satisfies Meta<typeof CardDuplicateWarnings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ExactMatch: Story = {};
export const ConflictingAnswer: Story = {
  args: {
    candidates: [
      {
        id: "go-channel",
        areaTitle: "Go",
        front: "What does a Go channel do?",
        back: "It starts a goroutine.",
      },
    ],
  },
};
export const Mobile: Story = { globals: { viewport: { value: "recallMobile", isRotated: false } } };
