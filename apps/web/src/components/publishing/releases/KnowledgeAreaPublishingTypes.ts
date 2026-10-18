import type {
  PublicationOperationStore,
  PublicationForkOperationStore,
  PublishedMediaGateway,
  PublishingApi,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";

export type UpstreamUpdateState =
  | { readonly status: "available"; readonly versionId: string }
  | { readonly status: "no-public-update" | "unavailable" | "failed" };

export type KnowledgeAreaPublishingProps = {
  readonly area?: KnowledgeArea | null;
  readonly embedded?: boolean;
  readonly initialUpstreamUpdate?: UpstreamUpdateState;
  readonly initialRequest?: { readonly versionId: string; readonly token?: string };
  readonly lineageArea?: KnowledgeArea;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ) => boolean | Promise<boolean>;
  readonly onUpdate?: (
    area: KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
  ) => Promise<boolean>;
  readonly forkOperationStore?: PublicationForkOperationStore;
  readonly createForkOperationId?: () => string;
  readonly publicationOperationStore?: PublicationOperationStore;
  readonly releaseDraftScope?: string;
  readonly retainDraftsOnDevice?: boolean;
  readonly createPublishShareToken?: () => string;
  readonly initialPublishRecovery?: "pending" | "conflict";
  readonly initialForkRecovery?: "local-save-failure";
  readonly transport?: PublishingApi;
  readonly mediaGateway?: PublishedMediaGateway;
  readonly mediaStore?: MediaStore;
  readonly initialPublication?: {
    readonly versionId: string;
    readonly token: string | null;
    readonly owner?: boolean;
    readonly visibility?: "private" | "unlisted" | "public";
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  };
};
