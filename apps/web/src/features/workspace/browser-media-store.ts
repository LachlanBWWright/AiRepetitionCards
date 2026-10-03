import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { MediaStore, MediaStoreFailure, StoredMediaAsset } from "@recall/local-store";
import { desktopMediaStore } from "./desktop-media-store";

const mediaDatabaseName = "recall-media";
const mediaObjectStore = "assets";
const StoredAssetSchema = Schema.Struct({
  reference: MediaReferenceSchema,
  bytes: Schema.Uint8ArrayFromSelf,
});

function failure(operation: MediaStoreFailure["operation"]): MediaStoreFailure {
  return { _tag: "MediaStoreFailure", operation };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(mediaDatabaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(mediaObjectStore, { keyPath: "reference.id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Media storage upgrade blocked"));
  });
}

function requestValue<A>(request: IDBRequest<A>): Promise<A> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function decodeStoredAsset(input: unknown): StoredMediaAsset | null {
  const decoded = Schema.decodeUnknownEither(StoredAssetSchema)(input);
  return Either.isRight(decoded) ? decoded.right : null;
}

const indexedDbMediaStore: MediaStore = {
  get: (id) =>
    Effect.tryPromise({
      try: async () => {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(mediaObjectStore, "readonly");
          const complete = transactionDone(transaction);
          const row = await requestValue(transaction.objectStore(mediaObjectStore).get(id));
          await complete;
          return row;
        } finally {
          database.close();
        }
      },
      catch: () => failure("read"),
    }).pipe(
      Effect.flatMap((row) => {
        if (row === undefined) return Effect.succeed(null);
        const asset = decodeStoredAsset(row);
        return asset && asset.reference.id === id
          ? Effect.succeed(asset)
          : Effect.fail(failure("read"));
      }),
    ),
  put: (asset) =>
    Effect.tryPromise({
      try: async () => {
        const decoded = Schema.decodeUnknownEither(StoredAssetSchema)(asset);
        if (
          Either.isLeft(decoded) ||
          decoded.right.bytes.byteLength !== decoded.right.reference.byteLength
        ) {
          return false;
        }
        const database = await openDatabase();
        try {
          const transaction = database.transaction(mediaObjectStore, "readwrite");
          const complete = transactionDone(transaction);
          await requestValue(transaction.objectStore(mediaObjectStore).put(decoded.right));
          await complete;
          return true;
        } finally {
          database.close();
        }
      },
      catch: () => failure("write"),
    }).pipe(Effect.flatMap((written) => (written ? Effect.void : Effect.fail(failure("write"))))),
  delete: (id) =>
    Effect.tryPromise({
      try: async () => {
        const database = await openDatabase();
        try {
          const transaction = database.transaction(mediaObjectStore, "readwrite");
          const complete = transactionDone(transaction);
          await requestValue(transaction.objectStore(mediaObjectStore).delete(id));
          await complete;
        } finally {
          database.close();
        }
      },
      catch: () => failure("delete"),
    }),
  list: Effect.tryPromise({
    try: async () => {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(mediaObjectStore, "readonly");
        const complete = transactionDone(transaction);
        const rows = await requestValue(transaction.objectStore(mediaObjectStore).getAll());
        await complete;
        const assets = rows.map(decodeStoredAsset);
        return assets.some((asset) => asset === null)
          ? null
          : assets.flatMap((asset) => (asset ? [asset.reference] : []));
      } finally {
        database.close();
      }
    },
    catch: () => failure("list"),
  }).pipe(
    Effect.flatMap((references) =>
      references ? Effect.succeed(references) : Effect.fail(failure("list")),
    ),
  ),
};

function hasDesktopMediaBridge(): boolean {
  return typeof window !== "undefined" && window.recallDesktop?.media !== undefined;
}

export const browserMediaStore: MediaStore = {
  get: (id) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.get(id) : indexedDbMediaStore.get(id),
    ),
  put: (asset) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.put(asset) : indexedDbMediaStore.put(asset),
    ),
  delete: (id) =>
    Effect.suspend(() =>
      hasDesktopMediaBridge() ? desktopMediaStore.delete(id) : indexedDbMediaStore.delete(id),
    ),
  list: Effect.suspend(() =>
    hasDesktopMediaBridge() ? desktopMediaStore.list : indexedDbMediaStore.list,
  ),
};
