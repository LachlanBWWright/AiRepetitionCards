import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { createDeckSharingApi } from "@recall/application";
import type { DeckSharingHttpRequest } from "@recall/application";
import { DeckSharingPanel } from "./DeckSharingPanel";

const deckId = "00000000-0000-4000-8000-000000000101";
const versionId = "00000000-0000-4000-8000-000000000102";
const deck = {
  id: deckId,
  title: "Cell biology foundations",
  description: "A concise introduction to cells, organelles, and energy transfer.",
  language: "en",
  tags: ["biology", "cells"],
  authorName: "Recall Study Group",
  visibility: "public" as const,
  status: "active" as const,
  latestVersionId: versionId,
  version: 2,
  cardCount: 18,
  updatedAt: "2026-10-12T09:30:00.000Z",
  license: "CC BY 4.0",
  attribution: "Adapted from open course materials.",
};

function bodyFor(request: DeckSharingHttpRequest): unknown {
  const path = request.path.split("?")[0] ?? "";
  if (path === "/api/v1/decks" || path === "/api/v1/decks/mine")
    return { schemaVersion: 1, decks: [deck], nextCursor: null };
  if (path === `/api/v1/decks/${deckId}`)
    return {
      schemaVersion: 1,
      deck,
      versions: [
        {
          id: "00000000-0000-4000-8000-000000000100",
          version: 1,
          createdAt: "2026-10-01T09:30:00.000Z",
        },
        { id: versionId, version: 2, createdAt: deck.updatedAt },
      ],
      canManage: true,
    };
  if (path === "/api/v1/deck-subscriptions") return { schemaVersion: 1, subscriptions: [] };
  return { schemaVersion: 1, deck };
}

const api = createDeckSharingApi((request) =>
  Effect.succeed({ status: 200, body: bodyFor(request) }),
);

const meta = {
  title: "Screens/Deck Sharing",
  component: DeckSharingPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-screen max-w-7xl bg-background p-6 sm:p-10">
        <Story />
      </main>
    ),
  ],
  args: { api, onReviewVersion: () => undefined, onOpenDeck: () => undefined },
} satisfies Meta<typeof DeckSharingPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Discover: Story = {};
export const OwnerManagement: Story = { args: { initialDeckId: deckId } };
