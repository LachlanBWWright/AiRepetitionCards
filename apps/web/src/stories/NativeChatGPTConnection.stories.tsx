import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeChatGPTConnection } from "../../../mobile/src/components/account/NativeChatGPTConnection";
const noop = () => undefined;
const meta = {
  title: "Screens/Native ChatGPT Connection",
  component: NativeChatGPTConnection,
  parameters: { layout: "padded" },
  args: {
    ready: true,
    available: true,
    busy: false,
    signingIn: false,
    message: null,
    status: { activeClientId: null, accounts: [] },
    signIn: noop,
    cancel: noop,
    signOut: noop,
    manageUsage: noop,
  },
} satisfies Meta<typeof NativeChatGPTConnection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NoRecallAccount: Story = {};
export const WaitingForBrowser: Story = { args: { busy: true, signingIn: true } };
export const Connected: Story = {
  args: {
    status: {
      activeClientId: "oaiapp_example",
      accounts: [
        {
          clientId: "oaiapp_example",
          label: "ChatGPT account",
          email: "learner@example.test",
          signedIn: true,
          planEnabled: true,
        },
      ],
    },
  },
};
export const IdentityOnly: Story = {
  args: {
    status: {
      activeClientId: "oaiapp_example",
      accounts: [
        {
          clientId: "oaiapp_example",
          label: "ChatGPT account",
          email: "learner@example.test",
          signedIn: true,
          planEnabled: false,
        },
      ],
    },
  },
};
export const ExpoGo: Story = { args: { available: false } };
export const RevocationUnconfirmed: Story = {
  args: {
    message:
      "Signed out of ChatGPT on this device. Remote revocation could not be confirmed; disconnect the app in ChatGPT Settings → Usage.",
  },
};
