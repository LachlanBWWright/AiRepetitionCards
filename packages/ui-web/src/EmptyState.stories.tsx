import "./catalog.css";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Shared UI/Empty State",
  component: EmptyState,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog">
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
      <p className="eyebrow">RECALL · SHARED UI</p>
      <h1>
        Make the next step <em>clear.</em>
      </h1>
      <div className="component-catalog-grid">
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
