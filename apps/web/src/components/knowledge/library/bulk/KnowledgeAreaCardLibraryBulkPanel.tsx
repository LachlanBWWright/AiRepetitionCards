import type { LearningArea, Workspace } from "@recall/domain";
import { Button, Input } from "@recall/ui-web";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@recall/ui-web/components/dialog";
import type { useKnowledgeAreaCardLibraryBulkActions } from "./KnowledgeAreaCardLibraryBulkActions";
import { KnowledgeAreaCardLibraryBulkDestination } from "./KnowledgeAreaCardLibraryBulkDestination";
import type { ChangeEvent } from "react";

type KnowledgeAreaCardLibraryBulkPanelProps = {
  readonly area: LearningArea;
  readonly workspace: Workspace | undefined;
  readonly restoring: boolean;
  readonly actions: ReturnType<typeof useKnowledgeAreaCardLibraryBulkActions>;
};

export function KnowledgeAreaCardLibraryBulkPanel({
  area,
  workspace,
  restoring,
  actions,
}: KnowledgeAreaCardLibraryBulkPanelProps) {
  const {
    selectedIds,
    bulkAction,
    setBulkAction,
    bulkTags,
    setBulkTags,
    destination,
    setDestination,
    bulkPending,
    bulkError,
    bulkRequest,
    setBulkRequest,
    beginBulk,
    submitBulk,
    setSelected,
  } = actions;
  const submitLabel = bulkPending
    ? "Saving selection…"
    : bulkRequest && bulkError
      ? "Retry selection"
      : bulkAction === "delete"
        ? "Confirm deletion"
        : bulkAction === "move"
          ? "Confirm move"
          : "Save tags";
  const title =
    bulkAction === "tags"
      ? "Add tags"
      : bulkAction === "move"
        ? "Move selected cards"
        : "Delete selected cards";
  const description =
    bulkAction === "move"
      ? "Scheduling and review history move with the cards. Matching objectives are linked by title; attachments and tags are retained."
      : bulkAction === "delete"
        ? "Review history is preserved. Recover these cards from Deleted cards."
        : "New tags are added without changing schedules or review history.";
  const handleTagsChange = (event: ChangeEvent<HTMLInputElement>) => {
    setBulkTags(event.target.value);
  };

  return (
    <>
      {selectedIds.length > 0 && (
        <div
          className="my-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2"
          aria-label="Bulk card actions"
        >
          <span className="text-sm" role="status">
            {selectedIds.length} selected
          </span>
          <>
            <Button
              variant="secondary"
              disabled={restoring || bulkPending}
              onClick={() => {
                beginBulk("tags");
              }}
            >
              Add tags
            </Button>
            <Button
              variant="secondary"
              disabled={restoring || bulkPending || (workspace?.areas.length ?? 0) < 2}
              onClick={() => {
                beginBulk("move");
              }}
            >
              Move cards
            </Button>
            <Button
              variant="secondary"
              disabled={restoring || bulkPending}
              onClick={() => {
                beginBulk("delete");
              }}
            >
              Delete selected
            </Button>
            <Button
              variant="secondary"
              disabled={bulkPending}
              onClick={() => {
                setSelected([]);
              }}
            >
              Clear selection
            </Button>
          </>
        </div>
      )}
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulkPending) {
            setBulkAction(null);
            setBulkRequest(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {selectedIds.length} selected cards. {description}
            </DialogDescription>
          </DialogHeader>
          {bulkAction === "tags" && (
            <label>
              Tags (comma separated)
              <Input
                value={bulkTags}
                disabled={bulkPending || Boolean(bulkRequest)}
                onChange={handleTagsChange}
              />
            </label>
          )}
          {bulkAction === "move" && (
            <KnowledgeAreaCardLibraryBulkDestination
              workspace={workspace}
              currentAreaId={area.id}
              destination={destination}
              disabled={bulkPending || Boolean(bulkRequest)}
              onDestinationChange={setDestination}
            />
          )}
          {bulkError && (
            <p role="alert" className="text-sm text-destructive">
              {bulkError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={bulkPending}
              onClick={() => {
                setBulkAction(null);
                setBulkRequest(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={bulkPending || restoring || selectedIds.length === 0}
              onClick={() => void submitBulk()}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
