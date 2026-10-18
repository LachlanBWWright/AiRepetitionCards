import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { Effect } from "effect";
import { MAX_PORTABLE_DECK_PACKAGE_BYTES } from "@recall/application";

export type NativePortableDeckTransferFailure = {
  readonly _tag: "NativePortableDeckTransferFailure";
  readonly reason:
    | "picker-failed"
    | "file-unavailable"
    | "file-too-large"
    | "file-read-failed"
    | "sharing-unavailable"
    | "share-failed";
};
export type PickedPortableDeckFile = { readonly name: string; readonly bytes: Uint8Array };
const failure = (
  reason: NativePortableDeckTransferFailure["reason"],
): NativePortableDeckTransferFailure => ({
  _tag: "NativePortableDeckTransferFailure",
  reason,
});

export function pickPortableDeckPackage(): Effect.Effect<
  PickedPortableDeckFile | null,
  NativePortableDeckTransferFailure
> {
  return Effect.gen(function* () {
    const selection = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: ["application/zip", "application/octet-stream"],
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () => failure("picker-failed"),
    });
    if (selection.canceled) return null;
    const asset = selection.assets[0];
    if (!asset) return yield* Effect.fail(failure("file-unavailable"));
    if (typeof asset.size === "number" && asset.size > MAX_PORTABLE_DECK_PACKAGE_BYTES)
      return yield* Effect.fail(failure("file-too-large"));
    const result = yield* Effect.tryPromise({
      try: async () => {
        const file = new File(asset.uri);
        if (file.size > MAX_PORTABLE_DECK_PACKAGE_BYTES) return null;
        return await file.bytes();
      },
      catch: () => failure("file-read-failed"),
    });
    return result
      ? { name: asset.name, bytes: result }
      : yield* Effect.fail(failure("file-too-large"));
  });
}

export function sharePortableDeckPackage(
  bytes: Uint8Array,
  filename: string,
): Effect.Effect<void, NativePortableDeckTransferFailure> {
  return Effect.gen(function* () {
    if (bytes.byteLength > MAX_PORTABLE_DECK_PACKAGE_BYTES)
      return yield* Effect.fail(failure("file-too-large"));
    const available = yield* Effect.tryPromise({
      try: () => Sharing.isAvailableAsync(),
      catch: () => failure("sharing-unavailable"),
    });
    if (!available) return yield* Effect.fail(failure("sharing-unavailable"));
    const file = yield* Effect.try({
      try: () => new File(Paths.cache, filename),
      catch: () => failure("share-failed"),
    });
    yield* Effect.try({
      try: () => {
        file.write(bytes);
      },
      catch: () => failure("share-failed"),
    });
    yield* Effect.ensuring(
      Effect.tryPromise({
        try: () =>
          Sharing.shareAsync(file.uri, {
            mimeType: "application/zip",
            dialogTitle: "Portable deck package",
          }),
        catch: () => failure("share-failed"),
      }),
      Effect.sync(() => {
        file.delete();
      }),
    );
  });
}
