import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { StatusBadge } from "./StatusBadge";

const meta = {
  title: "Design System/Feedback",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullScreenCatalog: Story = {
  name: "Full-screen · feedback catalog",
  render: () => (
    <main className="component-catalog feedback-catalog">
      <p className="eyebrow">RECALL · DESIGN SYSTEM</p>
      <h1>
        Clear feedback for <em>every state.</em>
      </h1>
      <p className="subheading">Reusable status, empty-state, and dialog patterns.</p>
      <div className="component-catalog-grid">
        <section>
          <h2>Status</h2>
          <p>Show useful context in a compact, consistent form.</p>
          <div className="feedback-badges">
            <StatusBadge>Saved locally</StatusBadge>
            <StatusBadge tone="success">Synced</StatusBadge>
            <StatusBadge tone="warning">Offline branch</StatusBadge>
            <StatusBadge tone="danger">Needs attention</StatusBadge>
          </div>
        </section>
        <section>
          <h2>Empty state</h2>
          <p>Explain what happened and give the learner a next step.</p>
          <EmptyState
            className="feedback-empty"
            icon="✳"
            title="You’re all caught up."
            description="New cards will appear here when they’re ready to review."
            action={<Button variant="secondary">Browse your areas</Button>}
          />
        </section>
      </div>
      <Dialog labelledBy="feedback-dialog-title" onClose={() => undefined}>
        <div className="modal feedback-dialog">
          <p className="eyebrow">YOUR LIBRARY</p>
          <h2 id="feedback-dialog-title">Delete this learning area?</h2>
          <p className="modal-copy">
            Its cards will leave your library. Your private review history stays saved.
          </p>
          <div className="modal-actions">
            <Button variant="secondary">Keep area</Button>
            <Button variant="danger">Delete area</Button>
          </div>
        </div>
      </Dialog>
    </main>
  ),
};
