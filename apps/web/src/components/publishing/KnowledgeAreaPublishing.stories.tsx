import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Either, Schema } from "effect";
import { createPublishingApi, publicationContentHash, toKnowledgeArea } from "@recall/application";
import type { PublishingHttpRequest, PublicationForkOperationStore } from "@recall/application";
import {
  ForkPublishedKnowledgeAreaRequestSchema,
  PublishKnowledgeAreaRequestSchema,
} from "@recall/contracts";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  MediaReferenceSchema,
} from "@recall/domain";
import type { KnowledgeArea } from "@recall/domain";
import type { PublishedMediaGateway } from "@recall/application";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { KnowledgeAreaPublishing } from "./KnowledgeAreaPublishing";
import { mockWorkspace } from "@/features/workspace/mock-data";

const storyUuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const storyArea = {
  ...mockWorkspace.areas[0]!,
  id: createAreaId(storyUuid(1)),
  cards: mockWorkspace.areas[0]!.cards.map((card, index) => ({
    ...card,
    id: createAssessmentId(storyUuid(index + 2)),
  })),
};
const areaResult = Effect.runSync(Effect.either(toKnowledgeArea(storyArea, true)));
const mockImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const mediaId = Array.from(sha256(mockImageBytes), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
const mediaReference = Schema.decodeUnknownEither(MediaReferenceSchema)({
  id: mediaId,
  mimeType: "image/png",
  byteLength: mockImageBytes.byteLength,
});
const mediaAsset: StoredMediaAsset | null = Either.isRight(mediaReference)
  ? { reference: mediaReference.right, bytes: mockImageBytes }
  : null;
const mediaAreaResult =
  mediaAsset === null
    ? areaResult
    : Effect.runSync(
        Effect.either(
          toKnowledgeArea(
            {
              ...storyArea,
              cards: storyArea.cards.map((card, index) =>
                index === 0 ? { ...card, media: [mediaAsset.reference] } : card,
              ),
            },
            true,
            true,
          ),
        ),
      );
const versionId = storyUuid(100);
const shareToken = "A".repeat(43);
const mockForkOperations = new Map<string, string>();
const mockForkOperationStore: PublicationForkOperationStore = {
  read: (id) => Effect.sync(() => mockForkOperations.get(id) ?? null),
  write: (id, operationId) =>
    Effect.sync(() => {
      mockForkOperations.set(id, operationId);
    }),
  clear: (id) =>
    Effect.sync(() => {
      mockForkOperations.delete(id);
    }),
};
const mockMediaGateway: PublishedMediaGateway = {
  upload: () => Effect.void,
  read: () => Effect.succeed(mediaAsset),
};
const mockMediaStore: MediaStore = {
  get: () => Effect.succeed(mediaAsset),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed(mediaAsset ? [mediaAsset.reference] : []),
};
function PublishingStory({
  review = false,
  media = false,
  lifecycle,
  rights = "unknown",
  recovery,
  forkRecovery = false,
  upstream,
}: {
  readonly review?: boolean | "comparison";
  readonly media?: boolean;
  readonly lifecycle?: "active" | "revoked";
  readonly rights?: "unknown" | "inherited";
  readonly recovery?: "pending" | "conflict";
  readonly forkRecovery?: boolean;
  readonly upstream?: "available" | "no-public-update" | "unavailable" | "failed";
}) {
  const selectedResult = media ? mediaAreaResult : areaResult;
  if (Either.isLeft(selectedResult))
    return <main className="mx-auto mt-12 w-full max-w-5xl rounded-xl border bg-card p-5 shadow-sm sm:p-8">Story data could not be prepared.</main>;
  const area =
    rights === "inherited"
      ? {
          ...selectedResult.right,
          licence: "All rights reserved",
          attribution: "Original Biology Author",
          forkedFromVersionId: storyUuid(99),
        }
      : selectedResult.right;
  const lineageArea = {
    ...area,
    id: createAreaId(storyUuid(301)),
    sourceId: area.id,
    forkedFromVersionId: storyUuid(99),
    objectives: area.objectives.map((objective, index) => ({
      ...objective,
      id: createObjectiveId(storyUuid(index + 302)),
      sourceId: objective.id,
    })),
    cards: area.cards.map((card, index) => ({
      ...card,
      id: createAssessmentId(storyUuid(index + 402)),
      sourceId: card.id,
    })),
  };
  const updatedPublication = {
    ...area,
    title: `${area.title} · updated`,
    cards: area.cards.map((card, index) =>
      index === 0 && card.kind === "basic"
        ? { ...card, back: `${card.back}\n\nUpdated explanation: review the new example.` }
        : card,
    ),
  };
  const mockTransport = createPublishingApi((request: PublishingHttpRequest) =>
    Effect.succeed({
      status: 200,
      body: mockPublicationResponse(request, area),
    }),
  );
  return (
    <KnowledgeAreaPublishing
      area={area}
      forkOperationStore={mockForkOperationStore}
      publicationOperationStore={mockForkOperationStore}
      createPublishShareToken={() => shareToken}
      {...(recovery ? { initialPublishRecovery: recovery } : {})}
      createForkOperationId={() => storyUuid(900)}
      {...(review === "comparison" || upstream ? { lineageArea } : {})}
      {...(upstream
        ? {
            initialUpstreamUpdate:
              upstream === "available" ? { status: upstream, versionId } : { status: upstream },
          }
        : {})}
      onFork={() => !forkRecovery}
      {...(forkRecovery ? { initialForkRecovery: "local-save-failure" as const } : {})}
      transport={mockTransport}
      mediaGateway={mockMediaGateway}
      mediaStore={mockMediaStore}
      {...(review || lifecycle
        ? {
            initialPublication: {
              versionId,
              token: lifecycle === "revoked" ? null : shareToken,
              ...(lifecycle ? { owner: true } : {}),
              document: review === "comparison" ? updatedPublication : area,
              attribution: "Recall Biology Team",
              license: "CC BY 4.0",
            },
          }
        : {})}
    />
  );
}

function mockPublicationResponse(request: PublishingHttpRequest, area: KnowledgeArea) {
  if (request.path.includes("/updates"))
    return {
      schemaVersion: 1,
      knownVersion: { id: storyUuid(99), version: 1, sourceAreaId: area.id },
      latestPublicVersion: {
        id: versionId,
        version: 2,
        sourceAreaId: area.id,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    };
  if (request.path.endsWith("/token")) {
    const action =
      typeof request.body === "object" && request.body !== null && "action" in request.body
        ? request.body.action
        : null;
    return { versionId, token: action === "revoke" ? null : "B".repeat(43) };
  }
  if (request.path.endsWith("/fork")) {
    const operation = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaRequestSchema)(
      request.body,
    );
    if (Either.isLeft(operation)) return { schemaVersion: 1, error: "invalid-request" };
    const document = {
      ...area,
      id: createAreaId(storyUuid(200)),
      forkedFromVersionId: versionId,
      licence: "CC BY 4.0",
      attribution: "Recall Biology Team",
    };
    return {
      operationId: operation.right.operationId,
      saved: true,
      contentHash: publicationContentHash(document),
      areaId: document.id,
      document,
      attribution: "Recall Biology Team",
      license: "CC BY 4.0",
      forkedFromVersionId: versionId,
    };
  }
  if (request.method === "GET") {
    return {
      version: {
        id: versionId,
        version: 1,
        content: area,
        contentHash: publicationContentHash(area),
        attribution: "Recall Biology Team",
        license: "CC BY 4.0",
        forkedFromVersionId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
  }
  const requestValue = Schema.decodeUnknownEither(PublishKnowledgeAreaRequestSchema)(request.body);
  if (Either.isLeft(requestValue)) return { schemaVersion: 1, error: "invalid-request" };
  return {
    operationId: requestValue.right.operationId,
    version: {
      id: versionId,
      sourceAreaId: requestValue.right.sourceAreaId,
      version: 1,
      content: requestValue.right.content,
      contentHash: publicationContentHash(requestValue.right.content),
      visibility: requestValue.right.visibility,
      attribution: requestValue.right.attribution ?? null,
      license: requestValue.right.license ?? null,
      forkedFromVersionId: requestValue.right.forkedFromVersionId ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    ...(requestValue.right.shareToken ? { shareToken: requestValue.right.shareToken } : {}),
  };
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
export const PublicationLostResponse: Story = {
  name: "Share · recover interrupted publication",
  args: { recovery: "pending" },
};
export const PublicationChangedDraft: Story = {
  name: "Share · changed pending publication",
  args: { recovery: "conflict" },
};
export const PublishInheritedRights: Story = {
  name: "Share · preserve inherited rights",
  args: { rights: "inherited" },
};
export const PublishUnknownRights: Story = {
  name: "Share · choose permission and license",
  args: { rights: "unknown" },
};
export const ReviewSharedArea: Story = {
  name: "Share · review attribution and license",
  args: { review: true },
};
export const CompareUpstreamUpdate: Story = {
  name: "Share · compare upstream update",
  args: { review: "comparison" },
};
export const ReviewSharedAreaWithMedia: Story = {
  name: "Share · review media attachment",
  args: { review: true, media: true },
};
export const ActiveUnlistedShareLink: Story = {
  name: "Share · active unlisted link",
  args: { lifecycle: "active" },
};
export const RevokedUnlistedShareLink: Story = {
  name: "Share · revoked unlisted link",
  args: { lifecycle: "revoked" },
};

export const UpstreamUpdateAvailable: Story = {
  name: "Share · upstream update available",
  args: { upstream: "available" },
};
export const NoPublicUpstreamUpdate: Story = {
  name: "Share · no public upstream update",
  args: { upstream: "no-public-update" },
};
export const UpstreamSourceUnavailable: Story = {
  name: "Share · upstream source unavailable",
  args: { upstream: "unavailable" },
};
export const UpstreamCheckFailed: Story = {
  name: "Share · upstream check failed",
  args: { upstream: "failed" },
};

export const ForkLocalMediaSaveFailure: Story = {
  name: "Share · atomic copy save recovery",
  args: { review: true, media: true, forkRecovery: true },
};
