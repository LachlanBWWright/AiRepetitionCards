import { Text, View } from "react-native";
import { Either } from "effect";
import * as Crypto from "expo-crypto";
import { supabaseAuthClient } from "./src/storage/auth/supabase-auth";
import { NativeAppShell } from "./src/components/NativeAppShell";
import { NativeAccountTab } from "./src/components/account/NativeAccountTab";
import { NativePublishingPanel } from "./src/components/publishing/NativePublishingPanel";
import { NativeDeckSharingPanel } from "./src/components/sharing/NativeDeckSharingPanel";
import { encodePublicationShareToken } from "@recall/application";
import { nativePublishingClients } from "./src/app/state/AppEnvironment";
import { useAppController } from "./src/app/useAppController";
import { AppSubjectsHome } from "./src/app/subjects/AppSubjectsHome";
import { AppSubjectWorkspace } from "./src/app/subjects/AppSubjectWorkspace";
import { AppReviewPanel } from "./src/app/review/AppReviewPanel";
export default function App() {
  const model = useAppController();
  const {
    activeTab,
    setActiveTab,
    workspace,
    activeAreaId,
    reviewPending,
    setActiveAreaId,
    activeArea,
    resetLocalWorkspace,
    deckSharingApi,
    accountUserId,
    activePublishingArea,
    setSelectedDeckVersion,
    visibleSelectedDeckVersion,
    nativeForkOperationStore,
    nativePublicationOperationStore,
    activeKnowledgeArea,
    mediaStore,
    addPublishedFork,
    saveDeckUpdate,
    chatGPT,
    dailyReminders,
    accountEmail,
    syncOwnershipIssue,
    syncCloudWorkspace,
    syncConflictWorkspace,
    useServerWorkspace,
    importKnowledgeArea,
    exportActiveArea,
    restorePrivateBackup,
    exportPrivateBackup,
    exportAccountData,
    deleteAccountData,
  } = model;
  const currentSharingArea =
    activePublishingArea && Either.isRight(activePublishingArea)
      ? {
          id: activePublishingArea.right.id,
          title: activePublishingArea.right.title,
          ...(activePublishingArea.right.sourceId
            ? { sourceId: activePublishingArea.right.sourceId }
            : {}),
          ...(activePublishingArea.right.forkedFromVersionId
            ? { sourceVersionId: activePublishingArea.right.forkedFromVersionId }
            : {}),
        }
      : null;
  const reviewDeckVersion = (versionId: string, token: string | undefined) => {
    setSelectedDeckVersion({
      versionId,
      owner: accountUserId,
      ...(token ? { token } : {}),
    });
  };
  const initialDeckVersion = visibleSelectedDeckVersion
    ? {
        initialVersionId: visibleSelectedDeckVersion.versionId,
        ...(visibleSelectedDeckVersion.token
          ? { initialToken: visibleSelectedDeckVersion.token }
          : {}),
      }
    : {};
  return (
    <NativeAppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      areas={workspace?.areas ?? []}
      activeAreaId={activeAreaId}
      selectionDisabled={reviewPending}
      onSelectArea={(areaId) => {
        setActiveAreaId(areaId);
        model.setSubjectMode("overview");
      }}
      today={<AppSubjectsHome model={model} />}
      library={<AppSubjectWorkspace model={model} review={<AppReviewPanel model={model} />} />}
      tutor={null}
      sharing={
        <View className="gap-4">
          {deckSharingApi ? (
            <NativeDeckSharingPanel
              key={`deck-sharing-${accountUserId ?? "anonymous"}`}
              api={deckSharingApi}
              accountId={accountUserId}
              currentArea={currentSharingArea}
              onReviewVersion={reviewDeckVersion}
            />
          ) : (
            <Text className="text-sm text-recall-muted">
              Deck sharing is unavailable until the API URL is configured.
            </Text>
          )}
          <NativePublishingPanel
            releaseDraftScope={workspace?.syncOwnerId ?? "local"}
            {...(deckSharingApi ? { deckSharing: deckSharingApi } : {})}
            key={`${accountUserId ?? "anonymous"}:${visibleSelectedDeckVersion?.versionId ?? activeArea?.id ?? "receive-shared-area"}`}
            forkOperationStore={nativeForkOperationStore}
            createForkOperationId={Crypto.randomUUID}
            publicationOperationStore={nativePublicationOperationStore}
            createPublishShareToken={() => encodePublicationShareToken(Crypto.getRandomBytes(32))}
            area={
              activePublishingArea && Either.isRight(activePublishingArea)
                ? activePublishingArea.right
                : null
            }
            lineageArea={
              activeKnowledgeArea && Either.isRight(activeKnowledgeArea)
                ? activeKnowledgeArea.right
                : null
            }
            mediaStore={mediaStore}
            {...(process.env.EXPO_PUBLIC_RECALL_API_URL?.trim()
              ? { clients: nativePublishingClients }
              : {})}
            {...initialDeckVersion}
            onFork={async (...args) => {
              const forked = await addPublishedFork(...args);
              if (forked) setSelectedDeckVersion(null);
              return forked;
            }}
            onUpdate={saveDeckUpdate}
          />
        </View>
      }
      account={
        <NativeAccountTab
          chatGPT={chatGPT}
          dailyReminders={dailyReminders}
          accountUserId={accountUserId}
          cloudAvailable={supabaseAuthClient !== null}
          account={accountEmail}
          ownershipIssue={
            workspace?.syncOwnerId && accountUserId && workspace.syncOwnerId !== accountUserId
              ? "account-mismatch"
              : syncOwnershipIssue
          }
          accountPanel={{
            onSync: () => syncCloudWorkspace(),
            onAdoptLegacyOwner: () => syncCloudWorkspace(true),
            conflictAreas: syncConflictWorkspace?.areas.map((area) => area.title) ?? null,
            onUseServerVersion: useServerWorkspace,
            onImport: importKnowledgeArea,
            onExport: exportActiveArea,
            onImportDelimited: importKnowledgeArea,
            onExportDelimited: exportActiveArea,
            onBackupRestore: restorePrivateBackup,
            onBackupExport: exportPrivateBackup,
            onExportAccount: exportAccountData,
            onDeleteAccount: deleteAccountData,
          }}
          onResetWorkspace={resetLocalWorkspace}
        />
      }
    />
  );
}
