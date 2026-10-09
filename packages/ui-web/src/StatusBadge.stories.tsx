import type { Meta, StoryObj } from "@storybook/react";
import { StatusBadge } from "./StatusBadge";

const meta = {
  title: "Shared UI/Status Badge",
  component: StatusBadge,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-16">
        <Story />
      </main>
    ),
  ],
  args: { children: "Saved locally" },
  argTypes: {
    tone: { control: "inline-radio", options: ["neutral", "success", "warning", "danger"] },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Success: Story = { args: { tone: "success", children: "Synced" } };
export const Warning: Story = {
  args: { tone: "warning", children: "Offline · saved on this device" },
};
export const Error: Story = { args: { tone: "danger", children: "Sync needs attention" } };
export const FullScreenStates: Story = {
  name: "Full-screen · synchronization status",
  render: () => (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RECALL · SHARED UI</p>
      <h1>
        Your progress stays <em>visible.</em>
      </h1>
      <p className="text-sm text-muted-foreground">Each status uses a text label alongside its color.</p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section>
          <h2>Local workspace</h2>
          <p>Biology · 24 cards</p>
          <StatusBadge>Saved locally</StatusBadge>
        </section>
        <section>
          <h2>Cloud workspace</h2>
          <p>French · 18 cards</p>
          <StatusBadge tone="success">Synced</StatusBadge>
        </section>
        <section>
          <h2>Offline practice</h2>
          <p>Statistics · 12 cards</p>
          <StatusBadge tone="warning">Offline · saved on this device</StatusBadge>
        </section>
        <section>
          <h2>Recovery needed</h2>
          <p>History · 32 cards</p>
          <StatusBadge tone="danger">Sync needs attention</StatusBadge>
        </section>
      </div>
    </>
  ),
};
