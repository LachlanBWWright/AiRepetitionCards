import { type LibraryDraft } from "@recall/application";
import { Text, View } from "react-native";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import { NativeButton } from "../../ui/NativeButton";

type Props = {
  readonly pendingOpen: { readonly next: Editor | null } | null;
  readonly drafts: readonly LibraryDraft[];
  readonly notesLoaded: boolean;
  readonly canRetainDraft: boolean;
  readonly locked: boolean;
  readonly onContinueEditing: () => void;
  readonly onKeepDraftAndClose: () => Promise<void>;
  readonly onDiscardDraft: () => void;
  readonly onResumeDraft: (draft: LibraryDraft) => void;
};
export function NativeWorkspaceDrafts({
  pendingOpen,
  drafts,
  notesLoaded,
  canRetainDraft,
  locked,
  onContinueEditing,
  onKeepDraftAndClose,
  onDiscardDraft,
  onResumeDraft,
}: Props) {
  return (
    <>
      {pendingOpen && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">Keep this draft?</Text>
          <Text>
            Your edits haven’t been saved as a card or deck. Keep the draft to resume later, or
            discard it.
          </Text>
          <NativeButton
            label="Continue editing"
            tone="soft"
            onPress={() => {
              onContinueEditing();
            }}
          />
          {canRetainDraft && (
            <NativeButton
              label="Keep draft and close"
              disabled={!notesLoaded}
              onPress={() => {
                void onKeepDraftAndClose();
              }}
            />
          )}
          <NativeButton label="Discard draft" tone="soft" onPress={onDiscardDraft} />
        </View>
      )}
      {drafts.length > 0 && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">Resume a draft</Text>
          {drafts.map((draft) => (
            <DraftRow key={draft.key} draft={draft} locked={locked} onResume={onResumeDraft} />
          ))}
        </View>
      )}
    </>
  );
}

function draftLabel(draft: LibraryDraft): string {
  if (draft.kind === "area") return `Deck: ${draft.title || "Untitled"}`;
  return `Card: ${draft.front || draft.clozeText || "Untitled"}`;
}

function DraftRow({
  draft,
  locked,
  onResume,
}: {
  readonly draft: LibraryDraft;
  readonly locked: boolean;
  readonly onResume: (draft: LibraryDraft) => void;
}) {
  return (
    <View className="gap-2">
      <NativeButton
        label={draftLabel(draft)}
        tone="soft"
        disabled={locked}
        onPress={() => {
          onResume(draft);
        }}
      />
      <Text selectable className="text-sm text-recall-muted">
        {draft.kind === "card" ? `${draft.front || draft.clozeText} — ${draft.back}` : draft.title}
      </Text>
    </View>
  );
}
