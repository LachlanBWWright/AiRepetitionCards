import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./Button";

const meta = {
  title: "Design System/Button",
  component: Button,
  parameters: { layout: "centered" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "quiet", "danger"] },
    size: { control: "inline-radio", options: ["small", "medium"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "Continue" } };
export const Secondary: Story = { args: { variant: "secondary", children: "Cancel" } };
export const Quiet: Story = { args: { variant: "quiet", children: "Add a card" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete" } };
export const Small: Story = { args: { size: "small", children: "Compact action" } };

export const FullScreenCatalog: Story = {
  name: "Full-screen · action catalog",
  parameters: { layout: "fullscreen" },
  render: () => (
    <main className="component-catalog">
      <p className="eyebrow">RECALL · DESIGN SYSTEM</p>
      <h1>
        Actions that feel <em>clear.</em>
      </h1>
      <p className="subheading">A small button set for focused study workflows.</p>
      <div className="component-catalog-grid">
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
          <h2>Quiet</h2>
          <p>An inline action that stays out of the way.</p>
          <Button variant="quiet">＋ Add a card</Button>
        </section>
        <section>
          <h2>Danger</h2>
          <p>A destructive action that needs attention.</p>
          <Button variant="danger">Delete area</Button>
        </section>
      </div>
      <div className="component-catalog-row">
        <Button size="small">Small action</Button>
        <Button disabled>Disabled state</Button>
      </div>
    </main>
  ),
};
