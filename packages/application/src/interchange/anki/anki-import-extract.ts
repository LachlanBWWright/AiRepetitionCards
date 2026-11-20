import { Effect } from "effect";
import { Unzip, UnzipInflate } from "fflate";
import { MAX_EXPANDED_BYTES, MAX_FILES, validArchivePath } from "./anki-import-archive";
import type { AnkiImportControl, AnkiImportError } from "./anki-import-contracts";

const chunkBytes = 64 * 1024;
/** Inflate incrementally so cancellation and pause checkpoints run between compressed chunks. */
export function extractAnkiArchive(
  input: Uint8Array,
  control: AnkiImportControl,
): Effect.Effect<Record<string, Uint8Array>, AnkiImportError> {
  return Effect.gen(function* () {
    const archive: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    const state: { failure?: AnkiImportError; expanded: number; files: number } = {
      expanded: 0,
      files: 0,
    };
    const fail = (reason: AnkiImportError["reason"]) => {
      state.failure = { _tag: "AnkiImportError", reason };
    };
    const unzip = new Unzip((file) => {
      state.files += 1;
      if (state.files > MAX_FILES) {
        fail("limits-exceeded");
        return;
      }
      if (!validArchivePath(file.name) || Object.hasOwn(archive, file.name)) {
        fail("invalid-archive");
        return;
      }
      archive[file.name] = new Uint8Array();
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, data, final) => {
        if (state.failure) return;
        if (error) {
          fail("invalid-archive");
          return;
        }
        size += data.byteLength;
        state.expanded += data.byteLength;
        if (state.expanded > MAX_EXPANDED_BYTES) {
          fail("limits-exceeded");
          return;
        }
        chunks.push(data);
        if (!final) return;
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        chunks.length = 0;
        archive[file.name] = bytes;
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < input.byteLength; offset += chunkBytes) {
      yield* control.checkpoint?.({
        phase: "archive",
        completed: offset,
        total: input.byteLength,
      }) ?? Effect.void;
      yield* Effect.try({
        try: () => {
          unzip.push(
            input.subarray(offset, offset + chunkBytes),
            offset + chunkBytes >= input.byteLength,
          );
        },
        catch: (): AnkiImportError => ({ _tag: "AnkiImportError", reason: "invalid-archive" }),
      });
      if (state.failure) return yield* Effect.fail(state.failure);
      if (control.checkpoint) yield* Effect.yieldNow();
    }
    return archive;
  });
}
