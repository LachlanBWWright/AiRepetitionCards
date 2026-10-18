import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatGPTPlanControls, ChatGPTPlanWelcome } from "./LocalChatGPTTutor";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
const noop = () => undefined;
const meta = {
  title: "Screens/Desktop ChatGPT Plan",
  component: ChatGPTPlanControls,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-5xl space-y-6 bg-background p-8">
        <div>
          <h1>AI settings</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    state: { enabled: true, activeClientId: null, accounts: [] },
    models: [],
    model: "",
    onModel: noop,
    onSignIn: noop,
    onSignOut: noop,
  },
} satisfies Meta<typeof ChatGPTPlanControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connect: Story = {
  name: "Connect ChatGPT without a Recall account",
};
export const PlanReady: Story = {
  args: {
    state: {
      enabled: true,
      activeClientId: "demo-client",
      accounts: [
        {
          clientId: "demo-client",
          label: "ChatGPT account",
          email: "learner@example.com",
          signedIn: true,
          planEnabled: true,
        },
      ],
    },
    models: [{ slug: "demo-study-model", displayName: "Study model (mock)" }],
    model: "demo-study-model",
  },
};
export const UsageLimit: Story = {
  args: {
    ...PlanReady.args,
    message: chatGptPlanFailureMessage({
      code: "subscription_sharing_usage_limit_exceeded",
      status: 429,
    }),
  },
};
export const IneligibleAccount: Story = {
  args: {
    ...PlanReady.args,
    message: chatGptPlanFailureMessage({
      code: "subscription_sharing_user_not_eligible",
      status: 403,
    }),
  },
};
export const PermissionRestriction: Story = {
  args: {
    ...PlanReady.args,
    message: chatGptPlanFailureMessage({ code: "chatpass_v2_scope_not_authorized", status: 403 }),
  },
};
export const TemporarilyUnavailable: Story = {
  args: {
    ...PlanReady.args,
    message: chatGptPlanFailureMessage({
      code: "subscription_sharing_usage_unavailable",
      status: 503,
    }),
  },
};
export const RevocationUnconfirmed: Story = {
  args: {
    message:
      "Signed out on this device. Remote revocation could not be confirmed; revoke app access in ChatGPT settings.",
  },
};

export const FirstPlanSignIn: Story = {
  render: (args) => (
    <>
      <ChatGPTPlanControls {...args} />
      <ChatGPTPlanWelcome onDismiss={noop} />
    </>
  ),
  args: { ...PlanReady.args },
};

export const SignInRequired: Story = {
  args: {
    message: "Sign in to ChatGPT to start tutoring.",
  },
};
export const ModelsUnavailable: Story = {
  args: {
    ...PlanReady.args,
    models: [],
    model: "",
    message: "Model catalog unavailable. Reload when your connection recovers.",
  },
};
export const UsagePaused: Story = {
  args: {
    ...PlanReady.args,
    state: {
      enabled: true,
      activeClientId: "demo-client",
      accounts: [
        {
          clientId: "demo-client",
          label: "ChatGPT account",
          email: "learner@example.com",
          signedIn: true,
          planEnabled: true,
          usagePaused: true,
        },
      ],
    },
  },
};

export const FirstSignInWithCatalogUnavailable: Story = {
  render: (args) => (
    <>
      <ChatGPTPlanControls {...args} />
      <ChatGPTPlanWelcome onDismiss={noop} />
    </>
  ),
  args: {
    ...PlanReady.args,
    models: [],
    model: "",
    message:
      "ChatGPT sign-in succeeded. The model catalog is temporarily unavailable; reload it when your connection recovers.",
  },
};
