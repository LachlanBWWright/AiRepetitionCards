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
      <main className="mx-auto max-w-5xl space-y-6 p-8">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            RECALL · YOUR ACCOUNT
          </p>
          <h1 className="my-0 text-3xl font-semibold tracking-tight">
            Keep your learning data portable.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your export includes cloud data and this browser&apos;s private study history.
          </p>
          <section className="mt-4 rounded-xl border bg-card p-4">
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
