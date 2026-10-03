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
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>Your sign-in methods.</h1>
          <p className="auth-copy">Signed in as learner@example.com</p>
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
