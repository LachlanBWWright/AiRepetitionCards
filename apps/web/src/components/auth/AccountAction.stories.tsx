import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { JSX } from "react";
import { AccountAction } from "./AccountAction";

const meta = {
  title: "Screens/Account",
  component: AccountAction,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: () => JSX.Element) => (
      <main className="component-catalog">
        <div>
          <p className="eyebrow">RECALL · YOUR ACCOUNT</p>
          <h1>Keep your learning data portable.</h1>
          <p>Your export includes cloud data and this browser&apos;s private study history.</p>
          <section className="account-export-story">
            <Story />
          </section>
        </div>
      </main>
    ),
  ],
} satisfies Meta<typeof AccountAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExportReady: Story = {
  name: "Account · export data",
  args: { demo: true, demoEmail: "learner@example.com" },
};

export const DeleteConfirmation: Story = {
  name: "Account · delete confirmation",
  args: { demo: true, demoEmail: "learner@example.com", demoDeleteConfirm: true },
};
