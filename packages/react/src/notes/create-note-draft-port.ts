import type { LibraryNotes } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { NoteDraftPort } from "./note-authoring-ports";

type Update = (
  change: (notes: LibraryNotes) => LibraryNotes,
  assets?: readonly StoredMediaAsset[],
) => void;
export function createNoteDraftPort(notes: LibraryNotes, update: Update): NoteDraftPort {
  return {
    drafts: notes.noteDrafts ?? [],
    retain: (draft, assets) => {
      update(
        (current) => ({
          ...current,
          noteDrafts: [
            ...(current.noteDrafts ?? []).filter((entry) => entry.key !== draft.key),
            draft,
          ],
        }),
        assets,
      );
    },
    discard: (key) => {
      update((current) => ({
        ...current,
        noteDrafts: (current.noteDrafts ?? []).filter((entry) => entry.key !== key),
      }));
    },
  };
}
