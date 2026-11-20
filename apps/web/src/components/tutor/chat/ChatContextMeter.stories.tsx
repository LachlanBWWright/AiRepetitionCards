import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatContextMeter } from "./ChatContextMeter";

const meta = {
  title: "Tutor/Context usage",
  component: ChatContextMeter,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChatContextMeter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Measured: Story = {
  args: {
    usage: {
      model: "study-model",
      inputTokens: 12500,
      outputTokens: 450,
      cachedInputTokens: 8000,
      cacheWriteTokens: 0,
    },
  },
};
