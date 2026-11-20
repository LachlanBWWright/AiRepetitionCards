import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import { AgentHandoverPanel } from "./AgentHandoverPanel";
import { browserAgentTransferPorts } from "./agent-transfer-ports";
import { NativeAgentHandoverPanel } from "../../../../../mobile/src/components/tutor/handover/NativeAgentHandoverPanel";

const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [
    {
      id: createAreaId("rust"),
      title: "Rust programming",
      color: "#123456",
      cards: [
        {
          id: createAssessmentId("ownership"),
          front: "What is borrowing?",
          back: "Temporary access without moving ownership.",
          objective: "Ownership",
          tags: ["rust"],
          schedule: newSchedule(new Date("2026-11-06T12:00:00Z")),
        },
      ],
    },
  ],
};
function Demo({ native = false }: { readonly native?: boolean }) {
  const [workspace, setWorkspace] = useState(initial);
  const Panel = native ? NativeAgentHandoverPanel : AgentHandoverPanel;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <p data-testid="current-card">
        Saved card: {workspace.areas[0]?.cards[0]?.front ?? "Deleted"}
      </p>
      <Panel
        workspace={workspace}
        areaId="rust"
        disabled={false}
        createId={() => "storybook-handover"}
        ports={browserAgentTransferPorts}
        conversation={[
          { role: "learner", content: "Why is my borrowed value unavailable?" },
          { role: "assistant", content: "Show the ownership transfer and lifetime involved." },
        ]}
        saveChanges={(command) =>
          applyWorkspaceAuthoringCommand(workspace, command, new Date()).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                setWorkspace(result.workspace);
              }),
            ),
            Effect.asVoid,
          )
        }
      />
    </div>
  );
}
const meta = {
  title: "Tutor/External AI handover",
  component: Demo,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Web: Story = { args: {} };
export const Native: Story = { args: { native: true } };
