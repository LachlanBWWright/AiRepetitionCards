import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { JSX } from "react";
import { ChatGPTAccountConnection } from "./ChatGPTAccountConnection";

const meta = {
  title: "Screens/ChatGPT Account Connection",
  component: ChatGPTAccountConnection,
  parameters: { layout: "fullscreen" },
  args: { demo: true, demoAvailable: true },
  decorators: [
    (Story: () => JSX.Element) => (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
        <section className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            ACCOUNT SETTINGS
          </p>
          <h1 className="my-0 text-3xl font-semibold tracking-tight">Your sign-in methods.</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Signed in as learner@example.com
          </p>
          <Story />
        </section>
      </main>
    ),
  ],
} satisfies Meta<typeof ChatGPTAccountConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Link: Story = { name: "Account · link ChatGPT" };
export const Linked: Story = {
  name: "Account · ChatGPT linked",
  args: {
    demoMessage: "ChatGPT is linked to this account. You can use it the next time you sign in.",
  },
};
export const Conflict: Story = {
  name: "Account · ChatGPT already linked elsewhere",
  args: {
    demoMessage:
      "This ChatGPT identity belongs to another Recall account. Sign in to that account or choose a different ChatGPT account.",
  },
};
