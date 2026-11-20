import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { MediaIdSchema } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { syncWorkspaceMedia, type WorkspaceMediaGateway } from "@recall/application";

function asset(value: string): StoredMediaAsset {
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  return {
    reference: {
      id: Schema.decodeUnknownSync(MediaIdSchema)(createHash("sha256").update(bytes).digest("hex")),
      mimeType: "image/png",
      byteLength: bytes.length,
    },
    bytes,
  };
}
await test("an interrupted media batch retains verified downloads and retries only missing bytes", () => {
  const first = asset(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  );
  // Same recognized PNG with an ancillary byte keeps the content address distinct.
  const secondBytes = Uint8Array.from([...first.bytes, 0]);
  const second: StoredMediaAsset = {
    reference: {
      ...first.reference,
      id: Schema.decodeUnknownSync(MediaIdSchema)(
        createHash("sha256").update(secondBytes).digest("hex"),
      ),
      byteLength: secondBytes.length,
    },
    bytes: secondBytes,
  };
  const stored = new Map<string, StoredMediaAsset>();
  const downloaded: string[] = [];
  let connected = false;
  const mediaStore: MediaStore = {
    get: (id) => Effect.succeed(stored.get(id) ?? null),
    put: (item) =>
      Effect.sync(() => {
        stored.set(item.reference.id, item);
      }),
    delete: (id) =>
      Effect.sync(() => {
        stored.delete(id);
      }),
    list: Effect.sync(() => [...stored.values()].map((item) => item.reference)),
  };
  const gateway: WorkspaceMediaGateway = {
    upload: () => Effect.void,
    read: (reference) => {
      downloaded.push(reference.id);
      return reference.id === first.reference.id
        ? Effect.succeed(first)
        : connected
          ? Effect.succeed(second)
          : Effect.fail({
              _tag: "WorkspaceMediaGatewayFailure",
              operation: "read",
              reason: "unavailable",
            });
    },
  };
  const transfer = () =>
    Effect.runSync(
      Effect.either(syncWorkspaceMedia(mediaStore, gateway, [first.reference, second.reference])),
    );
  assert.ok(Either.isLeft(transfer()));
  assert.deepEqual(stored.get(first.reference.id)?.bytes, first.bytes);
  assert.equal(stored.has(second.reference.id), false);
  connected = true;
  assert.ok(Either.isRight(transfer()));
  assert.deepEqual(stored.get(second.reference.id)?.bytes, secondBytes);
  assert.equal(downloaded.filter((id) => id === first.reference.id).length, 1);
  assert.equal(downloaded.filter((id) => id === second.reference.id).length, 2);
});
