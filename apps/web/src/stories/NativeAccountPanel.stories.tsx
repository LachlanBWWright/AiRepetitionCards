import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeAccountPanel } from "../../../mobile/src/components/NativeAccountPanel";

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
    onSync: async () => "Sync complete.",
    conflictAreas: null,
    onUseServerVersion: async () => "Server version loaded.",
    onImport: async () => "Import ready.",
    onExport: async () => "Package ready.",
    onBackupRestore: async () => "Backup restored.",
    onBackupExport: async () => "Backup ready.",
    onExportAccount: async () => "Account export ready.",
    onDeleteAccount: async () => "Mock account deleted.",
    account: "learner@example.com",
    onSignOut: async () => "Signed out. This device’s local study data remains available.",
    onRequestSignIn: async () => "Check your email for a sign-in link.",
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
    onAdoptLegacyOwner: async () => "Workspace ownership saved before sync.",
    onResetForAccount: () => undefined,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: renderAccount,
};
