import type { Meta, StoryObj } from "@storybook/react";
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
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-16">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RECALL · DESIGN SYSTEM</p>
      <h1>
        Clear feedback for <em>every state.</em>
      </h1>
      <p className="text-sm text-muted-foreground">Reusable status, empty-state, and dialog patterns.</p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section>
          <h2>Status</h2>
          <p>Show useful context in a compact, consistent form.</p>
          <div className="mt-4 flex flex-wrap gap-2">
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
            className="min-h-[120px] rounded-lg border border-dashed bg-muted/30 p-4"
            icon="✳"
            title="You’re all caught up."
            description="New cards will appear here when they’re ready to review."
            action={<Button variant="secondary">Browse your areas</Button>}
          />
        </section>
      </div>
      <Dialog labelledBy="feedback-dialog-title" onClose={() => undefined}>
        <div className="w-full max-w-[440px] space-y-4 rounded-xl bg-card p-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">YOUR LIBRARY</p>
          <h2 id="feedback-dialog-title">Delete this learning area?</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Its cards will leave your library. Your private review history stays saved.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button variant="secondary">Keep area</Button>
            <Button variant="danger">Delete area</Button>
          </div>
        </div>
      </Dialog>
    </main>
  ),
};
