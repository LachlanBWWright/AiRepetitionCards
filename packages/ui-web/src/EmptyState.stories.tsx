import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Shared UI/Empty State",
  component: EmptyState,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-16">
        <Story />
      </main>
    ),
  ],
  args: {
    icon: "✳",
    title: "You’re all caught up.",
    description: "New cards will appear here when they’re ready to review.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaughtUp: Story = {};
export const FirstArea: Story = {
  args: {
    title: "Start your learning library.",
    description: "Create a learning area and add your first cards.",
    action: <Button>Create learning area</Button>,
  },
};
export const NoSearchMatches: Story = {
  args: {
    title: "No matching cards.",
    description: "Try a different phrase or clear your filters.",
    action: <Button variant="secondary">Clear filters</Button>,
  },
};
export const ImportUnavailable: Story = {
  args: {
    icon: "!",
    title: "This file could not be imported.",
    description: "Choose a supported Recall JSON or Anki package to try again.",
    action: <Button variant="secondary">Choose another file</Button>,
  },
};
export const FullScreenStates: Story = {
  name: "Full-screen · empty and recovery states",
  render: () => (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RECALL · SHARED UI</p>
      <h1>
        Make the next step <em>clear.</em>
      </h1>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section>
          <EmptyState {...meta.args} />
        </section>
        <section>
          <EmptyState {...meta.args} {...FirstArea.args} />
        </section>
        <section>
          <EmptyState {...meta.args} {...NoSearchMatches.args} />
        </section>
        <section>
          <EmptyState {...meta.args} {...ImportUnavailable.args} />
        </section>
      </div>
    </>
  ),
};
