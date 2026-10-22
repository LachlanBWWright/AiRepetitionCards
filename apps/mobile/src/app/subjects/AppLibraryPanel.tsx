import { emptyActivityLibrary, type ActivityLibrary } from "@recall/domain";
import { NativeButton } from "../../components/ui/NativeButton";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import {
  mergeActivityLibraries,
  retainLibraryDraft,
  discardLibraryDraft,
  toggleCardFlag,
} from "@recall/application";
import { NativeLearningActivitiesPanel } from "../../components/activities/NativeLearningActivitiesPanel";
import { AppLibraryTransfer } from "../../components/library/AppLibraryTransfer";
import { NativeWorkspaceAuthoringPanel } from "../../components/authoring/NativeWorkspaceAuthoringPanel";
import { NativeWorkspaceSearchPanel } from "../../components/library/NativeWorkspaceSearchPanel";
import { NativeAppTab as AppTab } from "../../navigation";
import { pickNativeMedia } from "../../storage/media/native-media-picker";
import { AppPortableDeckTransfer } from "../transfers/AppPortableDeckTransfer";
import type { AppModel } from "../useAppController";
function mergeActivityLibrary(incoming: ActivityLibrary, existing: ActivityLibrary | undefined) {
  return Effect.runSync(
    Effect.either(mergeActivityLibraries(incoming, existing ?? emptyActivityLibrary)),
  );
}
export function AppLibraryPanel({ model }: { readonly model: AppModel }) {
  const {
    searchOpen,
    ready,
    reviewPending,
    workspaceLifetime,
    setSearchOpen,
    chatGPT,
    tutorScope,
    operationGeneration,
    workspace,
    workspaceRef,
    setActiveAreaId,
    setSearchTarget,
    setShowAnswer,
    setActiveTab,
    activeArea,
    libraryTransfer,
    showImportChoices,
    transferPending,
    importingCards,
    message,
    setLibraryTransfer,
    setShowImportChoices,
    importAnkiDeck,
    importCards,
    runLibraryTransfer,
    exportActiveArea,
    exportPrivateBackup,
    restorePrivateBackup,
    libraryNotes,
    activityRestoreError,
    onlyFlagged,
    setOnlyFlagged,
    now,
    startStudy,
    setTutorActivity,
    activeAreaId,
    tutorApi,
    authoringDisabledReason,
    applyAuthoringCommand,
    searchTarget,
    notesStore,
    learningActivityId,
    activityServices,
    deckUpdateInProgress,
  } = model;
  const portableDeckTransfer = <AppPortableDeckTransfer model={model} />;
  return (
    <View className="gap-4">
      <NativeButton
        tone="soft"
        label={searchOpen ? "Close search" : "Search everything"}
        disabled={!ready || reviewPending || workspaceLifetime.isBlocked()}
        onPress={() => {
          setSearchOpen((value) => !value);
        }}
      />
      {searchOpen && (
        <NativeWorkspaceSearchPanel
          notebookScope={chatGPT.tutorMode === "chatgpt" ? tutorScope : undefined}
          key={`${tutorScope}:${String(operationGeneration)}:${workspace?.syncOwnerId ?? "local"}`}
          workspace={workspace}
          disabled={!ready || reviewPending || workspaceLifetime.isBlocked()}
          onNavigate={(result) => {
            if (
              workspaceLifetime.isBlocked() ||
              reviewPending ||
              !workspaceRef.current?.areas.some((item) => item.id === result.areaId)
            )
              return;
            setActiveAreaId(result.areaId);
            setSearchTarget(result);
            setShowAnswer(false);
            setSearchOpen(false);
            model.setSubjectMode(
              ["area", "card", "objective"].includes(result.target.kind) ? "overview" : "improve",
            );
            setActiveTab(AppTab.Library);
          }}
        />
      )}
      <AppLibraryTransfer
        activeAreaTitle={activeArea?.title}
        canExport={Boolean(activeArea)}
        transfer={libraryTransfer}
        importChoicesOpen={showImportChoices}
        transferPending={transferPending}
        importingCards={importingCards}
        reviewPending={reviewPending}
        message={message}
        portableDeckTransfer={portableDeckTransfer}
        onOpenTransfer={(transfer) => {
          setLibraryTransfer(transfer);
          setShowImportChoices(false);
        }}
        onCloseTransfer={() => {
          setLibraryTransfer(null);
        }}
        onCloseImportChoices={() => {
          setShowImportChoices(false);
        }}
        onImportAnki={() => {
          setShowImportChoices(false);
          void importAnkiDeck();
        }}
        onImportCards={(format) => void importCards(format)}
        onRunTransfer={(action) => void runLibraryTransfer(action)}
        onExportActiveArea={exportActiveArea}
        onExportPrivateBackup={exportPrivateBackup}
        onRestorePrivateBackup={restorePrivateBackup}
      />
      {(libraryNotes.error || activityRestoreError) && (
        <View className="gap-2">
          <Text accessibilityRole="alert">{libraryNotes.error ?? activityRestoreError}</Text>
          <NativeButton label="Retry draft save" onPress={libraryNotes.retry} />
        </View>
      )}
      <NativeWorkspaceAuthoringPanel
        mediaStore={model.mediaStore}
        hideAreaPicker
        {...(model.createSubjectRequest > 0 ? { initialEditor: "create-area" as const } : {})}
        flaggedOnly={onlyFlagged}
        onFlaggedFilterChange={setOnlyFlagged}
        notes={libraryNotes.notes}
        notesLoaded={libraryNotes.loaded}
        onFlushDraft={libraryNotes.flush}
        onRetainNoteDraft={(draft, assets) => {
          libraryNotes.update(
            (notes) => ({
              ...notes,
              noteDrafts: [
                ...(notes.noteDrafts ?? []).filter((entry) => entry.key !== draft.key),
                draft,
              ],
            }),
            assets,
          );
        }}
        onDiscardNoteDraft={(key) => {
          libraryNotes.update((notes) => ({
            ...notes,
            noteDrafts: (notes.noteDrafts ?? []).filter((entry) => entry.key !== key),
          }));
        }}
        onRetainDraft={(draft, assets) => {
          libraryNotes.update((notes) => retainLibraryDraft(notes, draft), assets);
        }}
        onDiscardDraft={(key) => {
          libraryNotes.update((notes) => discardLibraryDraft(notes, key));
        }}
        onFlag={(id) => {
          libraryNotes.update((notes) => toggleCardFlag(notes, id));
        }}
        onSelectDeck={(id) => {
          setOnlyFlagged(false);
          setActiveAreaId(id);
          setSearchTarget(null);
          setShowAnswer(false);
        }}
        now={now}
        onStudy={startStudy}
        onImportCards={() => {
          setLibraryTransfer(null);
          setShowImportChoices(true);
        }}
        onGenerateCards={() => {
          setTutorActivity("materials");
          setSearchTarget(null);
          model.setSubjectMode("improve");
          model.setSubjectSection("materials");
          setActiveTab(AppTab.Library);
        }}
        workspace={workspace}
        activeAreaId={activeAreaId}
        tutorApi={tutorApi}
        disabled={authoringDisabledReason !== undefined}
        {...(authoringDisabledReason === undefined
          ? {}
          : { disabledReason: authoringDisabledReason })}
        createId={Crypto.randomUUID}
        onPickAttachment={pickNativeMedia}
        onCommand={applyAuthoringCommand}
        searchTarget={searchTarget}
      />
      {activeArea && (
        <NativeLearningActivitiesPanel
          key={`activities:${notesStore.scope}:${activeArea.id}`}
          areaId={activeArea.id}
          {...(learningActivityId ? { initialActivityId: learningActivityId } : {})}
          cards={activeArea.cards}
          {...(activityServices ? { services: activityServices } : {})}
          objectives={activeArea.objectives ?? []}
          {...(libraryNotes.notes.activityLibrary
            ? { library: libraryNotes.notes.activityLibrary }
            : {})}
          disabled={
            deckUpdateInProgress || !libraryNotes.loaded || authoringDisabledReason !== undefined
          }
          createId={Crypto.randomUUID}
          onSave={(activityLibrary) => {
            if (
              workspaceLifetime.isBlocked() ||
              workspaceLifetime.generation() !== operationGeneration ||
              !libraryNotes.loaded ||
              authoringDisabledReason !== undefined
            )
              return Promise.resolve(false);
            const validation = { valid: true };
            libraryNotes.update((notes) => {
              const merged = mergeActivityLibrary(activityLibrary, notes.activityLibrary);
              if (Either.isLeft(merged)) {
                validation.valid = false;
                return notes;
              }
              return { ...notes, activityLibrary: merged.right };
            });
            return validation.valid ? libraryNotes.flush() : Promise.resolve(false);
          }}
        />
      )}
    </View>
  );
}
