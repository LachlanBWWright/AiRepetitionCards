import type { KnowledgeArea } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import type {
  DeckSharingApi,
  PublicationForkOperationStore,
  PublicationOperationStore,
  PublishedMediaGateway,
  PublishingApi,
  ReleaseDraftStore,
} from "@recall/application";

export type NativePublishingPanelUpstreamUpdateState =
  | { readonly status: "available"; readonly versionId: string }
  | { readonly status: "no-public-update" | "unavailable" | "failed" };

export type NativePublishingPanelProps = {
  readonly area: KnowledgeArea | null;
  readonly initialUpstreamUpdate?: NativePublishingPanelUpstreamUpdateState;
  readonly lineageArea?: KnowledgeArea | null;
  readonly mediaStore: MediaStore | null;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    sourceVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ) => Promise<boolean>;
  readonly clients?: { readonly publishing: PublishingApi; readonly media: PublishedMediaGateway };
  readonly initialPublication?: {
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null;
  readonly initialVersionId?: string;
  readonly initialToken?: string;
  readonly forkOperationStore: PublicationForkOperationStore;
  readonly createForkOperationId: () => string;
  readonly publicationOperationStore: PublicationOperationStore;
  readonly createPublishShareToken: () => string;
  readonly deckSharing?: DeckSharingApi;
  readonly releaseDraftScope?: string;
  readonly releaseDraftStore?: ReleaseDraftStore;
  readonly onUpdate?: (
    area: KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
  ) => Promise<boolean>;
};

export type NativePublishingPanelPublication = {
  readonly versionId: string;
  readonly token: string | null;
  readonly document: KnowledgeArea;
  readonly attribution: string | null;
  readonly license: string | null;
};
