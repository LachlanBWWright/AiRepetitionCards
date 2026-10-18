import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeAccountPanel } from "../../../mobile/src/components/account/NativeAccountPanel";

const meta = {
  title: "Screens/Native Account",
  component: NativeAccountPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Native account controls with deterministic mock data, including explicit account deletion confirmation.",
      },
    },
  },
} satisfies Meta<typeof NativeAccountPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderAccount = (args: ComponentProps<typeof NativeAccountPanel>) => (
  <main style={{ minHeight: "100vh", padding: 18, backgroundColor: "#faf9f6" }}>
    <h1 style={{ margin: "0 0 16px", color: "#203c34", fontSize: 24 }}>Account settings</h1>
    <NativeAccountPanel {...args} />
  </main>
);

export const DeleteConfirmation: Story = {
  name: "Account · deletion confirmation (native)",
  args: {
    onSync: () => Promise.resolve("Sync complete."),
    conflictAreas: null,
    onUseServerVersion: () => Promise.resolve("Server version loaded."),
    onImport: () => Promise.resolve("Import ready."),
    onExport: () => Promise.resolve("Package ready."),
    onBackupRestore: () => Promise.resolve("Backup restored."),
    onBackupExport: () => Promise.resolve("Backup ready."),
    onExportAccount: () => Promise.resolve("Account export ready."),
    onDeleteAccount: () => Promise.resolve("Mock account deleted."),
    account: "learner@example.com",
    onSignOut: () =>
      Promise.resolve("Signed out. This device’s local study data remains available."),
    onRequestSignIn: () => Promise.resolve("Check your email for a sign-in link."),
    initialDeleteConfirmationOpen: true,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: renderAccount,
};

export const WorkspaceAccountMismatch: Story = {
  name: "Account · workspace owner mismatch (native)",
  args: {
    ...DeleteConfirmation.args,
    initialDeleteConfirmationOpen: false,
    ownershipIssue: "account-mismatch",
    onResetForAccount: () => undefined,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: renderAccount,
};
export const LegacyWorkspaceOwner: Story = {
  name: "Account · legacy owner confirmation (native)",
  args: {
    ...DeleteConfirmation.args,
    initialDeleteConfirmationOpen: false,
    ownershipIssue: "owner-adoption-required",
    onAdoptLegacyOwner: () => Promise.resolve("Workspace ownership saved before sync."),
    onResetForAccount: () => undefined,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: renderAccount,
};

export const SignedOut: Story = {
  name: "Account · AI connection separate from Recall (native)",
  args: {
    ...DeleteConfirmation.args,
    account: null,
    initialDeleteConfirmationOpen: false,
  },
  render: renderAccount,
};
export const LocalOnly: Story = {
  name: "Account · local only (native)",
  args: { ...SignedOut.args, cloudAvailable: false },
  render: renderAccount,
};
