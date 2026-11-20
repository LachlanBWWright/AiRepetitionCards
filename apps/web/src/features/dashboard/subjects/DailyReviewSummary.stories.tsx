import type { Meta, StoryObj } from "@storybook/react-vite";
import { summarizeStudySubjects } from "@recall/application";
import { DailyReviewSummary } from "./DailyReviewSummary";
import { NativeDailyReviewSummary } from "../../../../../mobile/src/app/subjects/NativeDailyReviewSummary";
import { NativeSubjectSummaryRow } from "../../../../../mobile/src/app/subjects/NativeSubjectSummaryRow";
import { mockWorkspace } from "../../workspace/mock-data";

const meta = {
  title: "Home/Study entry",
  component: DailyReviewSummary,
  parameters: { layout: "padded" },
  args: { due: 3, disabled: false, onReview: () => undefined },
} satisfies Meta<typeof DailyReviewSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Due: Story = {};
export const CaughtUp: Story = { args: { due: 0 } };
export const Saving: Story = { args: { disabled: true } };
export const Native: Story = {
  parameters: { nativePreview: true },
  render: (args) => (
    <main className="mx-auto max-w-md p-4">
      <NativeDailyReviewSummary {...args} />
      {summarizeStudySubjects(mockWorkspace, Date.parse("2026-10-03T09:00:00Z")).map((row) => (
        <NativeSubjectSummaryRow
          key={row.area.id}
          row={row}
          disabled={args.disabled}
          onOpen={() => undefined}
        />
      ))}
    </main>
  ),
};
