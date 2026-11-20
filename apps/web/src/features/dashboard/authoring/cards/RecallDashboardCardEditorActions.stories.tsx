import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecallDashboardCardEditorActions } from "./RecallDashboardCardEditorActions";

const meta = {
  title: "Authoring/Card editor actions",
  component: RecallDashboardCardEditorActions,
  parameters: { layout: "fullscreen" },
  args: {
    editing: false,
    saving: false,
    duplicatesAccepted: true,
    canSave: true,
    onCancel: () => undefined,
  },
  decorators: [
    (Story) => (
      <form
        className="border-t bg-background p-5"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Story />
      </form>
    ),
  ],
} satisfies Meta<typeof RecallDashboardCardEditorActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {};
export const Edit: Story = { args: { editing: true } };
export const Empty: Story = { args: { canSave: false } };
export const Saving: Story = { args: { saving: true } };
export const Phone: Story = {
  globals: { viewport: { value: "recallMobile", isRotated: false } },
};
