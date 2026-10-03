import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { StatusBadge } from "./StatusBadge";
import "./catalog.css";

function Confirmation({
  initialOpen = true,
  failed = false,
  saving = false,
}: {
  initialOpen?: boolean;
  failed?: boolean;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [deleted, setDeleted] = useState(false);
  return (
    <main className="component-catalog">
      <p className="eyebrow">RECALL · SHARED UI</p>
      <h1>
        Your learning <em>library.</em>
      </h1>
      <section className="catalog-area">
        <h2>Biology foundations</h2>
        <p>24 cards · 4 learning objectives</p>
        <Button
          variant="danger"
          disabled={deleted}
          onClick={() => {
            setOpen(true);
          }}
        >
          {deleted ? "Area removed" : "Delete learning area"}
        </Button>
      </section>
      {open && (
        <Dialog
          labelledBy="shared-dialog-title"
          onClose={() => {
            if (!saving) setOpen(false);
          }}
        >
          <div className="catalog-dialog">
            <p className="eyebrow">YOUR LIBRARY</p>
            <h2 id="shared-dialog-title">Delete Biology foundations?</h2>
            <p>Its cards will leave your library. Your private review history stays saved.</p>
            {failed && (
              <p role="alert">
                <StatusBadge tone="danger">Could not delete area. Try again.</StatusBadge>
              </p>
            )}
            <div className="catalog-dialog-actions">
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setOpen(false);
                }}
              >
                Keep area
              </Button>
              <Button
                variant="danger"
                disabled={saving}
                aria-busy={saving}
                onClick={() => {
                  if (!failed) {
                    setDeleted(true);
                    setOpen(false);
                  }
                }}
              >
                {saving ? "Deleting…" : failed ? "Try deleting again" : "Delete area"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}

const meta = {
  title: "Shared UI/Dialog",
  component: Confirmation,
  subcomponents: { Dialog },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Keyboard focus starts on the first available action and stays inside the dialog. Escape and backdrop clicks close it; closing restores focus to the trigger.",
      },
    },
  },
} satisfies Meta<typeof Confirmation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmationDialog: Story = {
  name: "Full-screen · delete confirmation",
  render: () => <Confirmation />,
};
export const RecoverableError: Story = {
  name: "Full-screen · recoverable error",
  render: () => <Confirmation failed />,
};
export const Saving: Story = {
  name: "Full-screen · pending deletion",
  render: () => <Confirmation saving />,
};
export const KeyboardWorkflow: Story = {
  name: "Keyboard · open and restore focus",
  render: () => <Confirmation initialOpen={false} />,
};
