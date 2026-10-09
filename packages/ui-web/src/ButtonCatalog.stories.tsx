import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta = {
  title: "Design System/Button",
  component: Button,
  parameters: { layout: "centered" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "danger"] },
    size: { control: "inline-radio", options: ["small", "medium"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "Continue" } };
export const Secondary: Story = { args: { variant: "secondary", children: "Cancel" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete" } };
export const Small: Story = { args: { size: "small", children: "Compact action" } };

export const FullScreenCatalog: Story = {
  name: "Full-screen · action catalog",
  parameters: { layout: "fullscreen" },
  render: () => (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-16">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RECALL · DESIGN SYSTEM</p>
      <h1>
        Actions that feel <em>clear.</em>
      </h1>
      <p className="text-sm text-muted-foreground">A small button set for focused study workflows.</p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section>
          <h2>Primary</h2>
          <p>The next important action.</p>
          <Button>Start studying</Button>
        </section>
        <section>
          <h2>Secondary</h2>
          <p>A reversible alternate action.</p>
          <Button variant="secondary">Cancel</Button>
        </section>
        <section>
          <h2>Secondary</h2>
          <p>A visible alternate action.</p>
          <Button variant="secondary">＋ Add a card</Button>
        </section>
        <section>
          <h2>Danger</h2>
          <p>A destructive action that needs attention.</p>
          <Button variant="danger">Delete area</Button>
        </section>
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button size="small">Small action</Button>
        <Button disabled>Disabled state</Button>
      </div>
    </main>
  ),
};
