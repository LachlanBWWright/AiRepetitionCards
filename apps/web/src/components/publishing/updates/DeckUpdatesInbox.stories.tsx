import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { createDeckSharingApi } from "@recall/application";
import type { DeckSharingHttpRequest } from "@recall/application";
import { DeckUpdatesInbox } from "./DeckUpdatesInbox";

const areaId = "00000000-0000-4000-8000-000000000201";
const deckId = "00000000-0000-4000-8000-000000000202";
const versionId = "00000000-0000-4000-8000-000000000203";
function bodyFor(request: DeckSharingHttpRequest): unknown {
  if (request.path.includes("/updates/read"))
    return {
      schemaVersion: 1,
      updates: [
        {
          deckId,
          areaId,
          knownVersionId: "00000000-0000-4000-8000-000000000204",
          latestVersionId: versionId,
          latestVersion: 3,
          title: "Cell biology foundations",
          releaseNotes: "Added a section on membrane transport.",
          createdAt: "2026-10-14T08:00:00.000Z",
          seen: true,
        },
      ],
    };
  return {
    schemaVersion: 1,
    updates: [
      {
        deckId,
        areaId,
        knownVersionId: "00000000-0000-4000-8000-000000000204",
        latestVersionId: versionId,
        latestVersion: 3,
        title: "Cell biology foundations",
        releaseNotes: "Added a section on membrane transport.",
        createdAt: "2026-10-14T08:00:00.000Z",
        seen: false,
      },
    ],
  };
}
const api = createDeckSharingApi((request) =>
  Effect.succeed({ status: 200, body: bodyFor(request) }),
);

const meta = {
  title: "Screens/Deck Updates Inbox",
  component: DeckUpdatesInbox,
  parameters: { layout: "centered" },
  args: { api, onReviewVersion: () => undefined },
} satisfies Meta<typeof DeckUpdatesInbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnreadUpdate: Story = {};
