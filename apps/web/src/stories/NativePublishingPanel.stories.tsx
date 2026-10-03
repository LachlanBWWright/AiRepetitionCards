import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Either } from "effect";
import {
  createPublishedMediaGateway,
  createPublishingApi,
  toKnowledgeArea,
} from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import type { PublicationForkOperationStore } from "@recall/application";
import { createCardId, createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { mockWorkspace } from "../features/workspace/mock-data";
import { NativePublishingPanel } from "../../../mobile/src/components/NativePublishingPanel";

const workspaceArea = mockWorkspace.areas.find((item) => item.id === "area-biology");
const decodedArea = workspaceArea
  ? Effect.runSync(Effect.either(toKnowledgeArea(workspaceArea, true)))
  : null;
const area = decodedArea && Either.isRight(decodedArea) ? decodedArea.right : null;
const lineageArea: KnowledgeArea | null = area
  ? {
      ...area,
      title: "My cell biology notes",
      forkedFromVersionId: "00000000-0000-4000-8000-000000000099",
      cards: area.cards.map((card) => ({
        ...card,
        id: createCardId(`fork-${card.id}`),
        sourceId: card.sourceId ?? card.id,
      })),
      objectives: area.objectives.map((objective) => ({
        ...objective,
        id: createObjectiveId(`fork-${objective.id}`),
        sourceId: objective.sourceId ?? objective.id,
      })),
    }
  : null;
const candidate: KnowledgeArea | null = area
  ? {
      ...area,
      title: "Cell biology · updated",
      cards: area.cards.map((card, index) =>
        index === 0 && card.kind === "basic"
          ? { ...card, back: "They convert energy from nutrients into ATP." }
          : card,
      ),
    }
  : null;
const mediaStore: MediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.succeed(undefined),
  delete: () => Effect.succeed(undefined),
  list: Effect.succeed([]),
};
const clients = {
  media: createPublishedMediaGateway(() => Effect.succeed({ status: 503, body: null })),
  publishing: createPublishingApi(() => Effect.succeed({ status: 503, body: null })),
};
const pendingOperations = new Map<string, string>();
const forkOperationStore: PublicationForkOperationStore = {
  read: (id) => Effect.sync(() => pendingOperations.get(id) ?? null),
  write: (id, operation) =>
    Effect.sync(() => {
      pendingOperations.set(id, operation);
    }),
  clear: (id) =>
    Effect.sync(() => {
      pendingOperations.delete(id);
    }),
};

const meta = {
  title: "Screens/Native Publishing",
  component: NativePublishingPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Native publish and receive controls shown with fixed Knowledge Area mock data and an injected transport.",
      },
    },
  },
} satisfies Meta<typeof NativePublishingPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShareAndReceive: Story = {
  name: "Publishing · share and receive (native)",
  args: {
    area: area ?? null,
    mediaStore,
    clients,
    forkOperationStore,
    publicationOperationStore: forkOperationStore,
    createPublishShareToken: () => "A".repeat(43),
    createForkOperationId: () => "00000000-0000-4000-8000-000000000900",
    onFork: async () => true,
  },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: (args) => (
    <div style={{ minHeight: 844, padding: 18, backgroundColor: "#faf9f6" }}>
      <NativePublishingPanel {...args} />
    </div>
  ),
};

export const CompareUpstreamUpdate: Story = {
  ...ShareAndReceive,
  name: "Publishing · compare upstream update (native)",
  args: {
    ...ShareAndReceive.args,
    lineageArea,
    initialVersionId: "00000000-0000-4000-8000-000000000100",
    initialPublication: candidate
      ? { document: candidate, attribution: "Recall Biology Team", license: "CC BY 4.0" }
      : null,
  },
};

export const UpstreamUpdateAvailable: Story = {
  ...ShareAndReceive,
  name: "Publishing · upstream update available (native)",
  args: {
    ...ShareAndReceive.args,
    lineageArea,
    initialUpstreamUpdate: {
      status: "available",
      versionId: "00000000-0000-4000-8000-000000000100",
    },
  },
};
export const NoPublicUpstreamUpdate: Story = {
  ...ShareAndReceive,
  name: "Publishing · no public upstream update (native)",
  args: {
    ...ShareAndReceive.args,
    lineageArea,
    initialUpstreamUpdate: { status: "no-public-update" },
  },
};
export const UpstreamSourceUnavailable: Story = {
  ...ShareAndReceive,
  name: "Publishing · upstream source unavailable (native)",
  args: { ...ShareAndReceive.args, lineageArea, initialUpstreamUpdate: { status: "unavailable" } },
};
export const UpstreamCheckFailed: Story = {
  ...ShareAndReceive,
  name: "Publishing · upstream check failed (native)",
  args: { ...ShareAndReceive.args, lineageArea, initialUpstreamUpdate: { status: "failed" } },
};
