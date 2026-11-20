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
      options: ["default", "destructive", "ghost"],
    },
    size: { control: "inline-radio", options: ["sm", "default", "lg", "icon"] },
  },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-16">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Danger: Story = { args: { variant: "destructive", children: "Delete card" } };
export const Small: Story = { args: { size: "sm", children: "Save" } };
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        RECALL · SHARED UI
      </p>
      <h1>
        Actions for <em>focused practice.</em>
      </h1>
      <p className="text-sm text-muted-foreground">
        Study actions, alternate choices, and saving feedback.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section>
          <h2>Study actions</h2>
          <Button>Start studying</Button>
          <Button variant="default">Browse cards</Button>
          <Button variant="default">Add a card</Button>
        </section>
        <section>
          <h2>Destructive action</h2>
          <p>Use a clear label before the confirmation dialog.</p>
          <Button variant="destructive">Delete learning area</Button>
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
          <Button size="sm" variant="default">
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        RECALL · SHARED UI
      </p>
      <h1>Actions and navigation</h1>
      <p className="text-sm text-muted-foreground">
        Buttons keep action semantics; composed links retain navigation.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 [&>section]:min-h-[150px] [&>section]:rounded-xl [&>section]:border [&>section]:bg-card [&>section]:p-5 [&>section>h2]:m-0 [&>section>h2]:text-sm [&>section>p]:my-2 [&>section>p]:text-xs [&>section>p]:text-muted-foreground">
        <section className="flex flex-col items-start gap-3">
          <h2>Navigation</h2>
          <a
            className="text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href="#library"
          >
            Browse your library
          </a>
          <a
            className="text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href="#review"
          >
            Return to review
          </a>
          <a
            className="text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href="#settings"
          >
            Study settings
          </a>
        </section>
        <section>
          <h2>Sizes</h2>
          <Button size="sm">Save</Button>
          <Button size="default">Start studying</Button>
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
