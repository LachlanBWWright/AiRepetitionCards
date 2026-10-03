import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TutorPrivacyView } from "./TutorPrivacyControls";

const noop = () => undefined;
const meta = {
  title: "Screens/Tutor Privacy",
  component: TutorPrivacyView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <p className="eyebrow">RECALL · CELL BIOLOGY</p>
          <h1>Control your tutor history.</h1>
          <section className="tutor-panel">
            <Story />
          </section>
        </div>
      </main>
    ),
  ],
  args: {
    onRequest: noop,
    onCancel: noop,
    onDelete: noop,
    state: {
      policy: { schemaVersion: 1, retentionDays: 30, deletionAvailable: true },
      confirming: false,
      busy: false,
      message: null,
    },
  },
} satisfies Meta<typeof TutorPrivacyView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RetentionPolicy: Story = {};
export const ConfirmClear: Story = {
  args: { state: { ...meta.args.state, confirming: true } },
};
export const ClearFailed: Story = {
  args: {
    state: {
      ...meta.args.state,
      confirming: true,
      message: "We could not confirm that tutor history was cleared. Try again.",
    },
  },
};
export const Cleared: Story = {
  args: {
    state: {
      ...meta.args.state,
      message: "Tutor history cleared. Your cards and reviews are still saved.",
    },
  },
};
export const LocalAccount: Story = {
  args: {
    local: true,
    state: {
      ...meta.args.state,
      policy: { schemaVersion: 1, retentionDays: null, deletionAvailable: true },
    },
  },
};
