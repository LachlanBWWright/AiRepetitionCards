import type { StoredMediaAsset } from "@recall/local-store";
import type { AnkiCollection, AnkiCompatibilityReport } from "./anki-import-contracts";
import { sanitizeField } from "./anki-import-media";

/** Bounded, plain-text evidence of conversion; never render source HTML as markup. */
export function ankiCompatibilityReport(
  collection: AnkiCollection,
  media: ReadonlyMap<string, StoredMediaAsset>,
  usedMediaCount: number,
): AnkiCompatibilityReport {
  const types = new Map(collection.noteTypes.map((type) => [type.id, type]));
  const samples: AnkiCompatibilityReport["samples"][number][] = [];
  let changedFieldCount = 0;
  let omittedRemoteMedia = 0;
  for (const note of collection.notes) {
    for (const template of types.get(note.noteTypeId)?.templates ?? []) {
      for (const source of [template.front, template.back]) {
        const result = sanitizeField(source, media);
        if (result && result !== "invalid-media") omittedRemoteMedia += result.omittedRemoteMedia;
      }
    }
    for (const [index, original] of note.fields.entries()) {
      const result = sanitizeField(original, media);
      const imported = result && result !== "invalid-media" ? result.text : "";
      if (result && result !== "invalid-media") omittedRemoteMedia += result.omittedRemoteMedia;
      if (original.trim() === imported) continue;
      changedFieldCount += 1;
      if (samples.length >= 5) continue;
      samples.push({
        noteGuid: note.guid,
        fieldName: types.get(note.noteTypeId)?.fields[index] ?? String(index + 1),
        original: original.slice(0, 1000),
        imported: imported.slice(0, 1000),
      });
    }
  }
  return {
    changedFieldCount,
    omittedRemoteMedia,
    omittedUnreferencedAttachments: Math.max(0, media.size - usedMediaCount),
    samples,
  };
}
