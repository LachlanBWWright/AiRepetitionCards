import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import { ChatGPTPlanControls } from "../tutor/connection/LocalChatGPTTutorPlanControls";
import { TutorPrivacyView } from "../tutor/connection/TutorPrivacyControls";

const noop = () => undefined;
const meta = {
  title: "Screens/Account settings dialog",
  component: AccountSettingsDialog,
  args: { open: true, onOpenChange: noop },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AccountSettingsDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

function AccountContents({
  checking = false,
  longLabels = false,
}: {
  readonly checking?: boolean;
  readonly longLabels?: boolean;
}) {
  const connection = {
    enabled: true,
    activeClientId: "demo",
    accounts: [
      {
        clientId: "demo",
        signedIn: true,
        planEnabled: true,
        label: "ChatGPT account",
        email: longLabels ? "learner.with.a.long.account.name@example.com" : "learner@example.com",
      },
    ],
  };
  const models = checking
    ? []
    : [
        {
          slug: "study",
          displayName: longLabels ? "Study model with an extended descriptive name" : "Study model",
        },
      ];
  return (
    <>
      <ChatGPTPlanControls
        state={connection}
        checking={checking}
        models={models}
        model={checking ? "" : "study"}
        onModel={noop}
        onSignIn={noop}
        onSignOut={noop}
        onReloadModels={noop}
      />
      <div className="border-t pt-6">
        <TutorPrivacyView
          local
          state={{ policy: null, busy: false, confirming: false, message: null }}
          onRequest={noop}
          onCancel={noop}
          onDelete={noop}
        />
      </div>
    </>
  );
}

export const Connected: Story = { args: { children: <AccountContents /> } };
export const Checking: Story = { args: { children: <AccountContents checking /> } };
export const LongLabels: Story = { args: { children: <AccountContents longLabels /> } };
