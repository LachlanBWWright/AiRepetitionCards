import type { DeckSharingApi } from "@recall/application";
import type { DeckSummary, DeckVersionSummary } from "@recall/contracts";
import type { KnowledgeArea } from "@recall/domain";

export type DeckSharingPanelProps = {
  readonly api: DeckSharingApi;
  readonly currentArea?: KnowledgeArea | null;
  readonly onReviewVersion: (versionId: string, token?: string) => void | Promise<void>;
  readonly onOpenDeck?: (deckId: string, token?: string) => void;
  readonly initialDeckId?: string;
  readonly initialToken?: string;
};

export type DeckSharingNotice = { readonly kind: "error" | "success"; readonly message: string };
export type DeckSharingDetail = {
  readonly deck: DeckSummary;
  readonly versions: readonly DeckVersionSummary[];
  readonly canManage: boolean;
};
