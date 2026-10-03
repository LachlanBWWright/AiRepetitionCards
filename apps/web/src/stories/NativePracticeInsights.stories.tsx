import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativePracticeInsights } from "../../../mobile/src/components/NativePracticeInsights";
import { mockWorkspace } from "../features/workspace/mock-data";
import { deletedAreaPendingWorkspace } from "../features/workspace/deleted-review-mock-data";

const meta = {
  title: "Screens/Native Practice Insights",
  component: NativePracticeInsights,
  parameters: { layout: "fullscreen" },
  args: {
    workspace: mockWorkspace,
    now: Date.parse("2026-10-03T09:00:00.000Z"),
    initiallyExpanded: true,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  decorators: [
    (Story) => (
      <main style={{ minHeight: 844, padding: 16, background: "#faf9f6" }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof NativePracticeInsights>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RecordedHistory: Story = {};
export const EmptyHistory: Story = {
  args: { workspace: { ...mockWorkspace, reviews: 0, reviewEvents: [] } },
};
export const DeletedAreaHistory: Story = { args: { workspace: deletedAreaPendingWorkspace } };
