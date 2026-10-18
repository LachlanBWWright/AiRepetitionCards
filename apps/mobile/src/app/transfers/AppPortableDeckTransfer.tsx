import { NativePortableDeckTransfer } from "../../components/library/NativePortableDeckTransfer";
import type { AppModel } from "../useAppController";
export function AppPortableDeckTransfer({ model }: { readonly model: AppModel }) {
  const {
    mediaStore,
    deckTransferWorkspace,
    libraryNotes,
    notesStore,
    activeArea,
    reviewPending,
    transferPending,
    importingCards,
    deckUpdateInProgress,
    authoringDisabledReason,
    importPortableDeck,
  } = model;
  return mediaStore && deckTransferWorkspace && libraryNotes.loaded ? (
    <NativePortableDeckTransfer
      key={`portable:${notesStore.scope}`}
      area={activeArea ?? null}
      workspace={deckTransferWorkspace}
      mediaStore={mediaStore}
      disabled={
        reviewPending ||
        transferPending ||
        importingCards ||
        deckUpdateInProgress ||
        authoringDisabledReason !== undefined
      }
      onImport={importPortableDeck}
    />
  ) : null;
}
