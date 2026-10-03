import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Either } from "effect";
import { toKnowledgeArea } from "@recall/application";
import { KnowledgeAreaPublishing, type PublicationTransport } from "./KnowledgeAreaPublishing";
import { mockWorkspace } from "@/features/workspace/mock-data";

const storyUuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const storyArea = {
  ...mockWorkspace.areas[0]!,
  id: storyUuid(1),
  cards: mockWorkspace.areas[0]!.cards.map((card, index) => ({
    ...card,
    id: storyUuid(index + 2),
  })),
};
const areaResult = Effect.runSync(Effect.either(toKnowledgeArea(storyArea, true)));
const versionId = storyUuid(100);
const shareToken = "A".repeat(43);
function PublishingStory({ review = false }: { readonly review?: boolean }) {
  if (Either.isLeft(areaResult))
    return <main className="publication-panel">Story data could not be prepared.</main>;
  const area = areaResult.right;
  const mockTransport: PublicationTransport = {
    publish: async () => ({
      version: {
        id: versionId,
        version: 1,
        content: area,
        contentHash: "a".repeat(64),
        attribution: null,
        license: null,
        forkedFromVersionId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      shareToken,
    }),
    receive: async () => ({
      version: {
        id: versionId,
        version: 1,
        content: area,
        contentHash: "a".repeat(64),
        attribution: "Recall Biology Team",
        license: "CC BY 4.0",
        forkedFromVersionId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
    fork: async () => ({
      document: area,
      attribution: "Recall Biology Team",
      license: "CC BY 4.0",
      forkedFromVersionId: versionId,
    }),
  };
  return (
    <KnowledgeAreaPublishing
      area={area}
      onFork={() => true}
      transport={mockTransport}
      {...(review
        ? {
            initialPublication: {
              versionId,
              token: shareToken,
              document: area,
              attribution: "Recall Biology Team",
              license: "CC BY 4.0",
            },
          }
        : {})}
    />
  );
}

const meta = {
  title: "Screens/Knowledge Area Sharing",
  component: PublishingStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Publish, preview and fork shared areas using deterministic mock data.",
      },
    },
  },
  args: { review: false },
} satisfies Meta<typeof PublishingStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PublishArea: Story = { name: "Share · publish area" };
export const ReviewSharedArea: Story = {
  name: "Share · review attribution and license",
  args: { review: true },
};
