import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import { recordReview } from "@recall/application";
import type { Workspace } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { StudyStatisticsPanel } from "./StudyStatisticsPanel";
const now = Date.parse("2026-10-19T12:00:00.000Z");
function studiedWorkspace(): Workspace {
  let workspace: Workspace = { ...mockWorkspace, reviewEvents: [] };
  for (let index = 0; index < 60; index += 1) {
    const area = workspace.areas[index % workspace.areas.length];
    const card = area?.cards[Math.floor(index / workspace.areas.length) % area.cards.length];
    if (!area || !card) continue;
    workspace = Effect.runSync(
      recordReview({
        workspace,
        areaId: area.id,
        cardId: card.id,
        eventId: `statistics-${String(index)}`,
        rating: index % 8 === 0 ? "again" : "good",
        ratedAt: new Date(
          now - (30 - Math.floor(index / 2)) * 86_400_000 + (index % 2) * 60_000,
        ).toISOString(),
        elapsedMs: 5000 + (index % 6) * 1000,
      }),
    ).workspace;
  }
  return workspace;
}
const meta = {
  title: "Knowledge/Detailed study statistics",
  component: StudyStatisticsPanel,
  args: { workspace: studiedWorkspace(), now },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-4xl p-6">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StudyStatisticsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};

export const NewCollection: Story = { args: { workspace: mockWorkspace } };
