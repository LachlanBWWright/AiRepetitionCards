import { RecallSubjectActivityDialog } from "../subjects/RecallSubjectActivityDialog";
import { Effect, Either } from "effect";
import { emptyActivityLibrary, type ActivityLibrary } from "@recall/domain";
import { mergeActivityLibraries, toggleCardFlag } from "@recall/application";
import type { AreaSettings } from "@recall/application";
import { OfflineReliabilityStatus } from "@/components/ui/OfflineReliabilityStatus";
import { writeDurableLibraryNotesPreference } from "@/lib/library-notes-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { toast } from "@recall/ui-web";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { LearningActivitiesPanel } from "@/components/knowledge/activities/LearningActivitiesPanel";
import { KnowledgeAreaCardLibrary } from "@/components/knowledge/library/KnowledgeAreaCardLibrary";
import { KnowledgeAreaSettings } from "@/components/knowledge/settings/KnowledgeAreaSettings";
import { isDesktopRuntime } from "@/lib/desktop-api";
import type { LearningArea } from "@/features/workspace/types";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function AreaSettingsDialog({
  area,
  open,
  onOpenChange,
  readLatest,
  saveAuthoringCommand,
}: {
  readonly area: LearningArea;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readLatest: () => LearningArea | null;
  readonly saveAuthoringCommand: RecallDashboardModel["saveAuthoringCommand"];
}) {
  function saveSettings(settings: AreaSettings, expectedBaseline: string) {
    return saveAuthoringCommand(
      { kind: "update-area-settings", areaId: area.id, settings },
      expectedBaseline,
    ).pipe(
      Effect.flatMap((saved) => {
        const updated = saved.areas.find((item) => item.id === area.id);
        return updated
          ? Effect.succeed(updated)
          : Effect.fail({
              reason: "unavailable" as const,
              message: "This subject is no longer available. Your draft is preserved.",
            });
      }),
      Effect.mapError((error) => ({ ...error, _tag: "AreaSettingsSaveFailure" as const })),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Subject settings</DialogTitle>
          <DialogDescription>Update {area.title}.</DialogDescription>
        </DialogHeader>
        <KnowledgeAreaSettings
          key={`area-settings-${area.id}`}
          area={area}
          readLatest={readLatest}
          onSave={saveSettings}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RecallDashboardCardLibrary({ model }: { readonly model: RecallDashboardModel }) {
  const {
    libraryDeckOpen,
    area,
    showAreaSettings,
    workspaceUnlocked,
    setShowAreaSettings,
    workspaceRef,
    saveAuthoringCommand,
    libraryNotes,
    onlyFlagged,
    setOnlyFlagged,
    applyBulkCards,
    editCard,
    deleteCard,
    addCard,
    workspace,
    restoreVersion,
    cardSaving,
    libraryMutation,
    reviewSaving,
    reviewSaveFailed,
    durableActivityDrafts,
    canRetainActivityDrafts,
    draftRetentionBusy,
    setDraftRetentionBusy,
    notesScope,
    localActivityId,
    activityServices,
    demo,
    cacheWritable,
    deckUpdatePending,
    deckUpdatePendingRef,
  } = model;
  function handleDurableChange(enabled: boolean) {
    setDraftRetentionBusy(true);
    void libraryNotes
      .flush()
      .then((flushed) => {
        if (!flushed) {
          toast.error("Activity drafts could not be saved before changing device retention.");
          return;
        }
        if (
          localWritesBlocked() ||
          workspaceRef.current.syncOwnerId !== notesScope ||
          !libraryNotes.getCurrentNotes()
        )
          return;
        if (!writeDurableLibraryNotesPreference(notesScope, enabled))
          toast.error("Draft retention could not be changed on this device.");
      })
      .catch(() => {
        toast.error("Activity drafts could not be saved before changing device retention.");
      })
      .finally(() => {
        setDraftRetentionBusy(false);
      });
  }
  function saveActivityLibrary(activityLibrary: ActivityLibrary): Promise<boolean> {
    if (
      localWritesBlocked() ||
      localSnapshotStale() ||
      !libraryNotes.loaded ||
      (!demo && !cacheWritable) ||
      reviewSaving ||
      reviewSaveFailed ||
      cardSaving ||
      deckUpdatePendingRef.current ||
      libraryMutation !== null
    )
      return Promise.resolve(false);
    const validation = { valid: true };
    libraryNotes.update((notes) => {
      const merged = Effect.runSync(
        Effect.either(
          mergeActivityLibraries(activityLibrary, notes.activityLibrary ?? emptyActivityLibrary),
        ),
      );
      if (Either.isLeft(merged)) {
        validation.valid = false;
        return notes;
      }
      return { ...notes, activityLibrary: merged.right };
    });
    return validation.valid ? libraryNotes.flush() : Promise.resolve(false);
  }
  return (
    <div className="min-w-0 space-y-6" hidden={!libraryDeckOpen || !area}>
      {area && (
        <LearningActivitiesPanel
          key={`activities:${notesScope}:${area.id}`}
          renderContainer={(content) => (
            <RecallSubjectActivityDialog initialActivityId={localActivityId} onAdd={addCard}>
              {content}
            </RecallSubjectActivityDialog>
          )}
          persistenceStatus={libraryNotes.persistenceStatus}
          storageLocation={libraryNotes.persistenceLocation}
          areaId={area.id}
          {...(localActivityId ? { initialActivityId: localActivityId } : {})}
          cards={area.cards}
          {...(activityServices ? { services: activityServices } : {})}
          objectives={area.objectives ?? []}
          {...(libraryNotes.notes.activityLibrary
            ? { library: libraryNotes.notes.activityLibrary }
            : {})}
          disabled={
            !libraryNotes.loaded ||
            (!demo && !cacheWritable) ||
            reviewSaveFailed ||
            reviewSaving ||
            cardSaving ||
            deckUpdatePending ||
            libraryMutation !== null
          }
          createId={() => crypto.randomUUID()}
          onSave={saveActivityLibrary}
        />
      )}
      {area && (
        <>
          <AreaSettingsDialog
            area={area}
            open={showAreaSettings && workspaceUnlocked}
            onOpenChange={setShowAreaSettings}
            readLatest={() =>
              workspaceRef.current.areas.find((item) => item.id === area.id) ?? null
            }
            saveAuthoringCommand={saveAuthoringCommand}
          />
          <KnowledgeAreaCardLibrary
            key={`area-library-${area.id}`}
            area={area}
            flaggedCardIds={libraryNotes.notes.flaggedCardIds}
            flaggedOnly={onlyFlagged}
            onFlaggedFilterChange={setOnlyFlagged}
            onFlag={(id) => {
              libraryNotes.update((notes) => toggleCardFlag(notes, id));
            }}
            onBulk={applyBulkCards}
            onEdit={editCard}
            onDelete={(target) => void deleteCard(target)}
            onAdd={addCard}
            workspace={workspace}
            showDeletedRecovery={false}
            onRestoreVersion={restoreVersion}
            restoring={cardSaving || libraryMutation !== null || reviewSaving || reviewSaveFailed}
            onOpenDuplicate={(candidate) => {
              const existing = workspaceRef.current.areas
                .flatMap((item) => item.cards)
                .find((item) => item.id === candidate.id);
              if (existing) editCard(existing);
            }}
          />
        </>
      )}
      {area && libraryNotes.loaded && (
        <OfflineReliabilityStatus
          quiet
          status={libraryNotes.persistenceStatus}
          storageLocation={libraryNotes.persistenceLocation}
          durableEnabled={durableActivityDrafts || isDesktopRuntime()}
          onRetry={libraryNotes.retry}
          {...(canRetainActivityDrafts && !draftRetentionBusy
            ? { onDurableChange: handleDurableChange }
            : {})}
        />
      )}
    </div>
  );
}
