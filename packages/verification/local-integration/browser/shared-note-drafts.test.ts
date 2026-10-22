import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Schema } from "effect";
import {
  BASIC_NOTE_TYPE,
  emptyLibraryNotes,
  libraryDraftMediaReferences,
} from "@recall/application";
import { MediaReferenceSchema } from "@recall/domain";
import { createBrowserLibraryNotesStore } from "../../../../apps/web/src/lib/library-notes-store";
import { browserMediaStore } from "../../../../apps/web/src/features/workspace/browser-media-store";

void test("shared note draft attachments survive editor/store recreation in the same tab", async () => {
  const store = createBrowserLibraryNotesStore("shared-note-draft-owner");
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const reference = Effect.runSync(
    Schema.decodeUnknown(MediaReferenceSchema)({
      id: "c".repeat(64),
      mimeType: "image/png",
      byteLength: bytes.byteLength,
    }),
  );
  const notes = {
    ...emptyLibraryNotes,
    noteDrafts: [
      {
        key: "new-note:subject",
        areaId: "subject",
        type: BASIC_NOTE_TYPE,
        note: {
          id: "draft-note",
          typeId: "basic",
          fields: { Front: "Unsaved **question**", Back: "" },
          tags: [],
          objectiveIds: [],
          media: [reference],
        },
        tagsText: "",
        baseline: "original-subject",
      },
    ],
  };
  await Effect.runPromise(store.write(notes, [{ reference, bytes }]));
  const restored = await Effect.runPromise(createBrowserLibraryNotesStore(store.scope).read);
  const restoredDraft = restored.noteDrafts?.[0];
  assert.ok(restoredDraft);
  assert.equal(restoredDraft.note.fields.Front, "Unsaved **question**");
  assert.equal(restoredDraft.baseline, "original-subject");
  assert.deepEqual(libraryDraftMediaReferences(restored), [reference]);
  assert.deepEqual((await Effect.runPromise(browserMediaStore.get(reference.id)))?.bytes, bytes);
  await Effect.runPromise(browserMediaStore.delete(reference.id));
});
