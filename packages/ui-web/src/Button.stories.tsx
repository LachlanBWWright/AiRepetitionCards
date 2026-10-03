import "./catalog.css";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta = {
  title: "Shared UI/Button",
  component: Button,
  parameters: { layout: "fullscreen" },
  args: { children: "Start studying" },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["primary", "secondary", "quiet", "danger", "outline", "link"],
    },
    size: { control: "inline-radio", options: ["small", "medium", "lg", "icon"] },
  },
  decorators: [
    (Story) => (
      <main className="component-catalog">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: "secondary", children: "Keep studying" } };
export const Quiet: Story = { args: { variant: "quiet", children: "Add a card" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete card" } };
export const Small: Story = { args: { size: "small", children: "Save" } };
export const Disabled: Story = { args: { disabled: true, children: "No cards due" } };
export const Saving: Story = {
  args: { disabled: true, "aria-busy": true, children: "Saving card…" },
};
export const KeyboardFocus: Story = {
  args: { autoFocus: true },
  parameters: {
    docs: {
      description: {
        story:
          "Focus starts on the button. Use Tab to inspect keyboard focus styling; Space or Enter activates the action.",
      },
    },
  },
};

export const FullScreenStates: Story = {
  name: "Full-screen · action states",
  render: () => (
    <>
      <p className="eyebrow">RECALL · SHARED UI</p>
      <h1>
        Actions for <em>focused practice.</em>
      </h1>
      <p className="subheading">Study actions, alternate choices, and saving feedback.</p>
      <div className="component-catalog-grid">
        <section>
          <h2>Study actions</h2>
          <Button>Start studying</Button>
          <Button variant="secondary">Browse cards</Button>
          <Button variant="quiet">Add a card</Button>
        </section>
        <section>
          <h2>Destructive action</h2>
          <p>Use a clear label before the confirmation dialog.</p>
          <Button variant="danger">Delete learning area</Button>
        </section>
        <section>
          <h2>Disabled and saving</h2>
          <Button disabled>No cards due</Button>
          <Button disabled aria-busy="true">
            Saving card…
          </Button>
        </section>
        <section>
          <h2>Keyboard focus</h2>
          <p>Use Tab to move between actions.</p>
          <Button autoFocus>Continue review</Button>
          <Button size="small" variant="secondary">
            Skip for now
          </Button>
        </section>
      </div>
    </>
  ),
};

export const ComposedLink: Story = {
  args: { asChild: true, children: <a href="#library">Browse your library</a> },
};
export const DisabledLink: Story = {
  args: { asChild: true, disabled: true, children: <a href="#library">Library unavailable</a> },
};
export const CompositionAndVariants: Story = {
  name: "Full-screen · composition and variants",
  render: () => (
    <>
      <p className="eyebrow">RECALL · SHARED UI</p>
      <h1>Actions and navigation</h1>
      <p className="subheading">Buttons keep action semantics; composed links retain navigation.</p>
      <div className="component-catalog-grid">
        <section>
          <h2>Navigation</h2>
          <Button asChild>
            <a href="#library">Browse your library</a>
          </Button>
          <Button asChild variant="outline">
            <a href="#review">Return to review</a>
          </Button>
          <Button asChild variant="link">
            <a href="#settings">Study settings</a>
          </Button>
        </section>
        <section>
          <h2>Sizes</h2>
          <Button size="small">Save</Button>
          <Button size="medium">Start studying</Button>
          <Button size="lg">Continue your session</Button>
          <Button size="icon" aria-label="Add a card">
            +
          </Button>
        </section>
        <section>
          <h2>Unavailable navigation</h2>
          <Button asChild disabled>
            <a href="#library">Library unavailable</a>
          </Button>
        </section>
        <section id="library">
          <h2>Class composition</h2>
          <Button className="gap-4">Continue review</Button>
          <p>Custom utility classes merge with the shared variants.</p>
        </section>
      </div>
    </>
  ),
};
