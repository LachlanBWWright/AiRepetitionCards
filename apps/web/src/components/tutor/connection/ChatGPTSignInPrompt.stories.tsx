import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatGPTSignInPrompt } from "./ChatGPTSignInPrompt";

const meta = {
  title: "Screens/ChatGPT Sign In Prompt",
  component: ChatGPTSignInPrompt,
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-[800px] space-y-7 p-8">
        <h2 className="text-center text-2xl">What would you like to understand?</h2>
        <Story />
      </main>
    ),
  ],
  args: {
    state: { enabled: true, activeClientId: null, accounts: [] },
    busy: false,
    checking: false,
    onSignIn: () => undefined,
  },
} satisfies Meta<typeof ChatGPTSignInPrompt>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = {};
export const ExpiredSession: Story = {
  args: {
    state: {
      enabled: true,
      activeClientId: "saved-account",
      accounts: [
        {
          clientId: "saved-account",
          label: "ChatGPT",
          email: null,
          signedIn: false,
          planEnabled: true,
        },
      ],
    },
  },
  render: (args) => (
    <>
      <p className="text-sm text-muted-foreground">
        This ChatGPT session is no longer usable. Sign in again to continue.
      </p>
      <ChatGPTSignInPrompt {...args} />
    </>
  ),
};
export const SigningIn: Story = { args: { busy: true } };
export const Connected: Story = {
  args: {
    state: {
      enabled: true,
      activeClientId: "saved-account",
      accounts: [
        {
          clientId: "saved-account",
          label: "ChatGPT",
          email: null,
          signedIn: true,
          planEnabled: true,
        },
      ],
    },
  },
};
