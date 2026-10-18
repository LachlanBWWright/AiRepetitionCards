import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { LearningArea, Workspace } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";

export type NativeWorkspaceBulkAction = "tags" | "move" | "delete";

export type NativeWorkspaceBulkActionsProps = {
  readonly area: LearningArea;
  readonly workspace: Workspace | null;
  readonly selectedIds: readonly string[];
  readonly bulkAction: NativeWorkspaceBulkAction | null;
  readonly bulkTags: string;
  readonly bulkDestination: string;
  readonly bulkRequest: { readonly command: unknown; readonly baseline?: string } | null;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly message: string | null;
  readonly filteredCount: number;
  readonly onSelectVisible: () => void;
  readonly onBegin: (action: NativeWorkspaceBulkAction) => void;
  readonly onClearSelection: () => void;
  readonly onChangeTags: (value: string) => void;
  readonly onChooseDestination: (areaId: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly renderField: (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
  ) => ReactNode;
};

function bulkActionTitle(action: NativeWorkspaceBulkAction): string {
  if (action === "tags") return "Add tags";
  if (action === "move") return "Move selected cards";
  return "Delete selected cards";
}

function bulkActionDescription(action: NativeWorkspaceBulkAction): string {
  if (action === "move")
    return "Cards receive fresh schedules in the destination. Original reviews stay in Deleted cards. Matching objectives are linked by title; tags and attachments are retained.";
  if (action === "delete") return "History is preserved. Recover cards from Deleted cards.";
  return "Tags are added without changing review schedules.";
}

function bulkSubmitLabel(
  pending: boolean,
  request: NativeWorkspaceBulkActionsProps["bulkRequest"],
  action: NativeWorkspaceBulkAction,
): string {
  if (pending) return "Saving selection…";
  if (request) return "Retry selection";
  if (action === "delete") return "Confirm deletion";
  if (action === "move") return "Confirm move";
  return "Save tags";
}

function chooseDestinationHandler(
  onChooseDestination: NativeWorkspaceBulkActionsProps["onChooseDestination"],
  areaId: string,
): () => void {
  return () => {
    onChooseDestination(areaId);
  };
}

export function NativeWorkspaceBulkActions({
  area,
  workspace,
  selectedIds,
  bulkAction,
  bulkTags,
  bulkDestination,
  bulkRequest,
  locked,
  pending,
  message,
  filteredCount,
  onSelectVisible,
  onBegin,
  onClearSelection,
  onChangeTags,
  onChooseDestination,
  onSubmit,
  onCancel,
  renderField,
}: NativeWorkspaceBulkActionsProps) {
  return (
    <>
      <View className="gap-2">
        <NativeButton
          label="Select visible cards"
          tone="soft"
          disabled={locked || bulkAction !== null || filteredCount === 0}
          onPress={onSelectVisible}
        />
        <Text accessibilityLiveRegion="polite">{selectedIds.length} selected</Text>
        {selectedIds.length > 0 && (
          <>
            <NativeButton
              label="Add tags"
              tone="soft"
              disabled={locked}
              onPress={() => {
                onBegin("tags");
              }}
            />
            <NativeButton
              label="Move cards"
              tone="soft"
              disabled={locked || (workspace?.areas.length ?? 0) < 2}
              onPress={() => {
                onBegin("move");
              }}
            />
            <NativeButton
              label="Delete selected"
              tone="soft"
              disabled={locked}
              onPress={() => {
                onBegin("delete");
              }}
            />
            <NativeButton
              label="Clear selection"
              tone="soft"
              disabled={locked || bulkAction !== null}
              onPress={onClearSelection}
            />
          </>
        )}
      </View>
      {bulkAction && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">{bulkActionTitle(bulkAction)}</Text>
          <Text>
            {selectedIds.length} selected. {bulkActionDescription(bulkAction)}
          </Text>
          {bulkAction === "tags" && renderField("Tags (comma separated)", bulkTags, onChangeTags)}
          {bulkAction === "move" && workspace && (
            <MoveDestinations
              decks={workspace.areas.filter((deck) => deck.id !== area.id)}
              selectedId={bulkDestination}
              disabled={locked || Boolean(bulkRequest)}
              onChoose={onChooseDestination}
            />
          )}
          <NativeButton
            label={bulkSubmitLabel(pending, bulkRequest, bulkAction)}
            disabled={locked}
            onPress={onSubmit}
          />
          {message && (
            <Text accessibilityRole="alert" className="text-sm text-recall-muted">
              {message}
            </Text>
          )}
          <NativeButton
            label="Cancel bulk action"
            tone="soft"
            disabled={pending}
            onPress={onCancel}
          />
        </View>
      )}
    </>
  );
}

function MoveDestinations({
  decks,
  selectedId,
  disabled,
  onChoose,
}: {
  readonly decks: readonly Pick<LearningArea, "id" | "title">[];
  readonly selectedId: string;
  readonly disabled: boolean;
  readonly onChoose: (id: string) => void;
}) {
  return (
    <>
      {decks.map((deck) => (
        <NativeButton
          key={deck.id}
          label={`${selectedId === deck.id ? "Selected: " : ""}${deck.title}`}
          tone="soft"
          disabled={disabled}
          onPress={chooseDestinationHandler(onChoose, deck.id)}
        />
      ))}
    </>
  );
}
