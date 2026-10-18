"use client";
import { Either } from "effect";
import type { ComponentProps } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@recall/ui-web/components/tabs";
import { AccountAction } from "@/components/auth/AccountAction";
import { KnowledgeAreaPublishing } from "@/components/publishing/releases/KnowledgeAreaPublishing";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { SidebarProvider } from "@recall/ui-web/components/sidebar";
import { RecallDashboardDialogs } from "./dialogs/RecallDashboardDialogs";
import { RecallDashboardDeckSharing } from "./library/RecallDashboardDeckSharing";
import { RecallDashboardReviewRecovery } from "./review/RecallDashboardReviewRecovery";
import { RecallDashboardAreaEditor } from "./authoring/subjects/RecallDashboardAreaEditor";
import { RecallDashboardCardEditor } from "./authoring/cards/RecallDashboardCardEditor";
import { RecallDashboardSidebarLayout } from "./layout/RecallDashboardSidebarLayout";
import { RecallDashboardSearchDialog } from "./layout/RecallDashboardSearchDialog";
import { RecallDashboardDeviceSettingsDialog } from "./dialogs/RecallDashboardDeviceSettingsDialog";
import { RecallDashboardContentLayout } from "./layout/RecallDashboardContentLayout";
import type { RecallDashboardProps } from "./RecallDashboardProps";
import { useRecallDashboardController } from "./state/useRecallDashboardController";
import { createRecallDashboardPublicationActions } from "./library/RecallDashboardPublicationActions";

type PublishingProps = ComponentProps<typeof KnowledgeAreaPublishing>;

function SharedLibraryPublishingTab(props: PublishingProps) {
  return (
    <TabsContent value="publish" forceMount className="data-[state=inactive]:hidden">
      <KnowledgeAreaPublishing {...props} />
    </TabsContent>
  );
}

export default function Home(props: RecallDashboardProps) {
  const model = useRecallDashboardController(props);
  const publicationActions = createRecallDashboardPublicationActions(model);
  const {
    shareKnowledgeOpen,
    workspaceUnlocked,
    setShareKnowledgeOpen,
    sharingTab,
    setSharingTab,
    notesScope,
    durableActivityDrafts,
    area,
    publishingAreaDocument,
    lineageAreaDocument,
    reviewedRequest,
    sharedRequest,
    accountSettingsOpen,
    setAccountSettingsOpen,
    accountSettingsReturnFocus: accountSettingsReturnFocusRef,
    accountMenuTrigger,
    demo,
    workspace,
  } = model;
  const publishingArea =
    publishingAreaDocument && Either.isRight(publishingAreaDocument)
      ? publishingAreaDocument.right
      : null;
  const lineageArea =
    lineageAreaDocument && Either.isRight(lineageAreaDocument)
      ? lineageAreaDocument.right
      : undefined;
  const initialRequest = reviewedRequest ?? sharedRequest;
  const publishingProps = {
    releaseDraftScope: notesScope,
    retainDraftsOnDevice: durableActivityDrafts || isDesktopRuntime(),
    embedded: true,
    area: publishingArea,
    ...(lineageArea ? { lineageArea } : {}),
    ...(initialRequest ? { initialRequest } : {}),
    onUpdate: publicationActions.onUpdate,
    onFork: publicationActions.onFork,
  } satisfies PublishingProps;
  return (
    <>
      <RecallDashboardDialogs model={model} />
      <SidebarProvider className="min-h-screen">
        <RecallDashboardSidebarLayout model={model} />

        <RecallDashboardContentLayout model={model} />

        <RecallDashboardSearchDialog model={model} />
        <Dialog open={shareKnowledgeOpen && workspaceUnlocked} onOpenChange={setShareKnowledgeOpen}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle id="publication-title">Shared library</DialogTitle>
              <DialogDescription>Find a deck to study, or share one of your own.</DialogDescription>
            </DialogHeader>
            <Tabs value={sharingTab} onValueChange={setSharingTab} className="min-w-0 space-y-5">
              <TabsList>
                <TabsTrigger value="browse">Browse decks</TabsTrigger>
                <TabsTrigger value="publish">Publish or import</TabsTrigger>
              </TabsList>
              <RecallDashboardDeckSharing model={model} />
              <SharedLibraryPublishingTab
                key={area?.id ?? "receive-shared-area"}
                {...publishingProps}
              />
            </Tabs>
          </DialogContent>
        </Dialog>
        <RecallDashboardReviewRecovery model={model} />
        <Dialog open={accountSettingsOpen} onOpenChange={setAccountSettingsOpen}>
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = accountSettingsReturnFocusRef.current;
              if (target?.isConnected) target.focus();
              else accountMenuTrigger.current?.focus();
              accountSettingsReturnFocusRef.current = null;
            }}
          >
            <DialogHeader>
              <DialogTitle>Account settings</DialogTitle>
              <DialogDescription>Connect ChatGPT and manage your account.</DialogDescription>
            </DialogHeader>
            <AccountAction demo={Boolean(demo)} {...(workspaceUnlocked ? { workspace } : {})} />
          </DialogContent>
        </Dialog>
        <RecallDashboardDeviceSettingsDialog model={model} />
        <RecallDashboardAreaEditor model={model} />
        <RecallDashboardCardEditor model={model} />
      </SidebarProvider>
    </>
  );
}
