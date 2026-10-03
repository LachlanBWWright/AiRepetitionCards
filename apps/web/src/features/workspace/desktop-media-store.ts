import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { MediaReference } from "@recall/domain";
import type { MediaStore, MediaStoreFailure, StoredMediaAsset } from "@recall/local-store";

const AssetSchema = Schema.Struct({
  reference: MediaReferenceSchema,
  bytes: Schema.Uint8ArrayFromSelf,
});
const AssetOrNullSchema = Schema.Union(AssetSchema, Schema.Null);
const ReferencesSchema = Schema.Array(MediaReferenceSchema);
type Decoded<A> = { readonly ok: true; readonly value: A } | { readonly ok: false };

function failure(operation: MediaStoreFailure["operation"]): MediaStoreFailure {
  return { _tag: "MediaStoreFailure", operation };
}

function replyValue(input: unknown): Decoded<unknown> {
  if (
    typeof input !== "object" ||
    input === null ||
    !("_tag" in input) ||
    input._tag !== "Success" ||
    !("value" in input)
  )
    return { ok: false };
  return { ok: true, value: input.value };
}

function decodeAssetOrNull(input: unknown): Decoded<StoredMediaAsset | null> {
  const decoded = Schema.decodeUnknownEither(AssetOrNullSchema)(input);
  return Either.isRight(decoded) ? { ok: true, value: decoded.right } : { ok: false };
}

function decodeReferences(input: unknown): Decoded<readonly MediaReference[]> {
  const decoded = Schema.decodeUnknownEither(ReferencesSchema)(input);
  return Either.isRight(decoded) ? { ok: true, value: decoded.right } : { ok: false };
}

function invoke<A>(
  operation: MediaStoreFailure["operation"],
  call: () => Promise<unknown>,
  decode: (input: unknown) => Decoded<A>,
): Effect.Effect<A, MediaStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const reply = replyValue(await call());
      return reply.ok ? decode(reply.value) : { ok: false as const };
    },
    catch: () => failure(operation),
  }).pipe(
    Effect.flatMap((result) =>
      result.ok ? Effect.succeed(result.value) : Effect.fail(failure(operation)),
    ),
  );
}

function invokeCommand(
  operation: "write" | "delete",
  call: () => Promise<unknown>,
): Effect.Effect<void, MediaStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const reply: unknown = await call();
      return (
        typeof reply === "object" &&
        reply !== null &&
        "_tag" in reply &&
        reply._tag === "Success" &&
        "value" in reply
      );
    },
    catch: () => failure(operation),
  }).pipe(
    Effect.flatMap((succeeded) => (succeeded ? Effect.void : Effect.fail(failure(operation)))),
  );
}

export const desktopMediaStore: MediaStore = {
  get: (id) =>
    Effect.suspend(() => {
      const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.media;
      return bridge
        ? invoke("read", () => bridge.get(id), decodeAssetOrNull).pipe(
            Effect.flatMap((asset) =>
              asset === null || asset.reference.id === id
                ? Effect.succeed(asset)
                : Effect.fail(failure("read")),
            ),
          )
        : Effect.fail(failure("read"));
    }),
  put: (asset: StoredMediaAsset) =>
    Effect.suspend(() => {
      const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.media;
      return bridge
        ? invokeCommand("write", () => bridge.put(asset))
        : Effect.fail(failure("write"));
    }),
  delete: (id) =>
    Effect.suspend(() => {
      const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.media;
      return bridge
        ? invokeCommand("delete", () => bridge.delete(id))
        : Effect.fail(failure("delete"));
    }),
  list: Effect.suspend(() => {
    const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.media;
    return bridge
      ? invoke("list", () => bridge.list(), decodeReferences)
      : Effect.fail(failure("list"));
  }),
};
