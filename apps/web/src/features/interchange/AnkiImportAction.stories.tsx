import { Effect } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type ReviewEvent,
} from "@recall/domain";
import { newSchedule, rebuildSchedule } from "@recall/scheduler";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { AnkiImportAction, type AnkiImportState } from "./AnkiImportAction";

const baseArea = mockWorkspace.areas[0]!;
const importedAreaId = createAreaId("00000000-0000-4000-8000-000000000301");
const importedCards = baseArea.cards.slice(0, 4).map((card, index) => ({
  ...card,
  id: createAssessmentId(`00000000-0000-4000-8000-${String(311 + index).padStart(12, "0")}`),
  sourceId: `anki:sample-guid-${index + 1}:${index === 3 ? 1 : 0}`,
  origin: "imported" as const,
  tags: ["cell-biology", "foundations"],
}));
const importedReviews: readonly ReviewEvent[] = [
  {
    id: createReviewEventId("00000000-0000-4000-8000-000000000321"),
    areaId: importedAreaId,
    cardId: importedCards[0]!.id,
    ratedAt: "2026-10-01T09:00:00.000Z",
    rating: "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "anki-import-v1",
    baseReviewEventId: null,
    effectiveReviewedAt: "2026-10-01T09:00:00.000Z",
  },
  {
    id: createReviewEventId("00000000-0000-4000-8000-000000000322"),
    areaId: importedAreaId,
    cardId: importedCards[0]!.id,
    ratedAt: "2026-10-02T09:00:00.000Z",
    rating: "easy",
    schedulerFamily: "fsrs",
    schedulerVersion: "anki-import-v1",
    baseReviewEventId: createReviewEventId("00000000-0000-4000-8000-000000000321"),
    effectiveReviewedAt: "2026-10-02T09:00:00.000Z",
  },
];
const proposal = {
  area: {
    ...baseArea,
    id: importedAreaId,
    title: "Cell biology essentials",
    sourceId: "anki-apkg",
    cards: importedCards.map((card) => ({
      ...card,
      ...(card.id === importedCards[0]!.id
        ? {
            schedule: Effect.runSync(
              rebuildSchedule(importedReviews.filter((review) => review.cardId === card.id)).pipe(
                Effect.catchAll(() =>
                  Effect.succeed(newSchedule(new Date("2026-10-01T09:00:00.000Z"))),
                ),
              ),
            ),
          }
        : {}),
    })),
  },
  media: [],
  reviewEvents: importedReviews,
  excludedReviewCount: 0,
  provenance: {
    format: "anki-apkg" as const,
    deckNames: ["Biology::Cell structure", "Biology::Membranes"],
    noteGuids: ["sample-guid-1", "sample-guid-2", "sample-guid-3"],
  },
};

function ImportStory({ initialState }: { readonly initialState: AnkiImportState }) {
  return (
    <main style={{ minHeight: "100vh", background: "#f2f4ef", padding: 30 }}>
      <AnkiImportAction
        color="#c4ed68"
        initialState={initialState}
        onAccept={() => Effect.succeed(undefined)}
      />
    </main>
  );
}

const meta = {
  title: "Screens/Anki Import",
  component: ImportStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Review-first Anki .apkg import states using deterministic mock decks and proposals.",
      },
    },
  },
} satisfies Meta<typeof ImportStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChoosePackage: Story = {
  name: "Anki · choose package",
  args: { initialState: { _tag: "ready" } },
};
export const ReviewImport: Story = {
  name: "Anki · review imported cards",
  args: { initialState: { _tag: "review", fileName: "cell-biology.apkg", proposal } },
};
export const UnsupportedPackage: Story = {
  name: "Anki · unsupported package",
  args: { initialState: { _tag: "error", reason: "unsupported-format" } },
};
