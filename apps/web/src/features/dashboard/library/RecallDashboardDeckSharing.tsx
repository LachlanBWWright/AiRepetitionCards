import { Either } from "effect";
import { TabsContent } from "@recall/ui-web/components/tabs";
import { DeckSharingPanel } from "@/components/publishing/sharing/DeckSharingPanel";
import { DeckUpdatesInbox } from "@/components/publishing/updates/DeckUpdatesInbox";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardDeckSharing({ model }: { readonly model: RecallDashboardModel }) {
  const {
    accountStatus,
    workspace,
    deckSharingApi,
    setReviewedRequest,
    setSharingTab,
    onOpenDeckPage,
    publishingAreaDocument,
    setShareKnowledgeOpen,
  } = model;
  return (
    <TabsContent value="browse" forceMount className="space-y-5 data-[state=inactive]:hidden">
      {accountStatus === "signed-in" && (
        <DeckUpdatesInbox
          key={`updates:${workspace.syncOwnerId ?? "local"}`}
          api={deckSharingApi}
          onReviewVersion={(versionId) => {
            setReviewedRequest({ versionId });
            setSharingTab("publish");
          }}
        />
      )}
      <DeckSharingPanel
        key={workspace.syncOwnerId ?? "local-deck-sharing"}
        api={deckSharingApi}
        {...(onOpenDeckPage ? { onOpenDeck: onOpenDeckPage } : {})}
        {...(publishingAreaDocument && Either.isRight(publishingAreaDocument)
          ? { currentArea: publishingAreaDocument.right }
          : {})}
        onReviewVersion={(versionId, token) => {
          setSharingTab("publish");
          setReviewedRequest({
            versionId,
            ...(token ? { token } : {}),
          });
          setShareKnowledgeOpen(true);
        }}
      />
    </TabsContent>
  );
}
