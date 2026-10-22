import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import { newSchedule } from "@recall/scheduler";
import { StudyTools } from "./StudyTools";

const now = new Date("2026-10-18T12:00:00.000Z");
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  reviewEvents: [],
  areas: [
    {
      id: createAreaId("tools-area"),
      title: "Cell biology",
      color: "#123456",
      cards: [
        {
          id: createAssessmentId("tools-card"),
          front: "What is the main role of mitochondria?",
          back: "They generate ATP through cellular respiration.",
          objective: "Cell biology",
          schedule: { ...newSchedule(now), lapses: 8 },
        },
      ],
    },
  ],
};
const mediaStore: MediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function StudyToolsStory() {
  const [workspace, setWorkspace] = useState(initial);
  const [message, setMessage] = useState("");
  const area = workspace.areas[0];
  if (!area) return null;
  return (
    <main className="mx-auto max-w-2xl p-6">
      <StudyTools
        workspace={workspace}
        area={area}
        card={area.cards.find(
          (card) => !workspace.schedulerSettings?.suspendedCardIds?.includes(card.id),
        )}
        mediaStore={mediaStore}
        disabled={false}
        onEdit={() => {
          setMessage("Edit card requested.");
        }}
        save={(command, baseline) =>
          applyWorkspaceAuthoringCommand(workspace, command, now, baseline).pipe(
            Effect.mapError((error) => ({ message: error.message })),
            Effect.map(({ workspace: saved }) => {
              setWorkspace(saved);
              return saved;
            }),
          )
        }
      />
      <p role="status">{message}</p>
      <p>Review events: {workspace.reviewEvents?.length ?? 0}</p>
      <p>Original due date: {area.cards[0]?.schedule.due}</p>
    </main>
  );
}
const meta = {
  title: "Knowledge/Study tools",
  component: StudyToolsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StudyToolsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
