import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema, type MediaReference } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { PublishedMediaUploadResponseSchema } from "@recall/contracts";
import { persistMediaAssets } from "./media-persistence";
import { verifyMediaAsset } from "./knowledge-area-package";

export type WorkspaceMediaGatewayFailure = {
  readonly _tag: "WorkspaceMediaGatewayFailure";
  readonly operation: "upload" | "read";
  readonly reason: "unavailable" | "invalid-media" | "account-changed";
};

/** Private cloud media port used to sync media referenced by a workspace. */
export type WorkspaceMediaGateway = {
  readonly upload: (asset: StoredMediaAsset) => Effect.Effect<void, WorkspaceMediaGatewayFailure>;
  readonly read: (
    reference: MediaReference,
  ) => Effect.Effect<StoredMediaAsset | null, WorkspaceMediaGatewayFailure>;
};

export type WorkspaceMediaHttpRequest = {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly responseType: "json" | "bytes";
};

export type WorkspaceMediaHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type WorkspaceMediaTransportFailure = {
  readonly _tag: "WorkspaceMediaTransportFailure";
};

export type WorkspaceMediaTransport = (
  request: WorkspaceMediaHttpRequest,
) => Effect.Effect<WorkspaceMediaHttpResponse, WorkspaceMediaTransportFailure>;

export type WorkspaceMediaSyncFailure = {
  readonly _tag: "WorkspaceMediaSyncFailure";
  readonly reason:
    | "invalid-reference"
    | "local-store-unavailable"
    | "cloud-unavailable"
    | "invalid-media"
    | "media-not-found"
    | "persistence-failed"
    | "account-changed";
};

const gatewayFailure = (
  operation: WorkspaceMediaGatewayFailure["operation"],
  reason: WorkspaceMediaGatewayFailure["reason"],
): WorkspaceMediaGatewayFailure => ({ _tag: "WorkspaceMediaGatewayFailure", operation, reason });

const syncFailure = (reason: WorkspaceMediaSyncFailure["reason"]): WorkspaceMediaSyncFailure => ({
  _tag: "WorkspaceMediaSyncFailure",
  reason,
});

function sameReference(left: MediaReference, right: MediaReference): boolean {
  return (
    left.id === right.id && left.mimeType === right.mimeType && left.byteLength === right.byteLength
  );
}

/** Shared private-cloud HTTP gateway. Platform code supplies only its HTTP/binary transport. */
export function createWorkspaceMediaGateway(
  transport: WorkspaceMediaTransport,
): WorkspaceMediaGateway {
  return {
    upload(asset) {
      if (!verifyMediaAsset(asset)) return Effect.fail(gatewayFailure("upload", "invalid-media"));
      return transport({
        method: "POST",
        path: `/api/v1/workspace/media/${encodeURIComponent(asset.reference.id)}`,
        headers: {
          "content-type": "application/octet-stream",
          "x-recall-media-reference": JSON.stringify(asset.reference),
        },
        body: asset.bytes.slice(),
        responseType: "json",
      }).pipe(
        Effect.mapError(() => gatewayFailure("upload", "unavailable")),
        Effect.flatMap((response) => {
          if (response.status === 409)
            return Effect.fail(gatewayFailure("upload", "account-changed"));
          if (response.status < 200 || response.status >= 300)
            return Effect.fail(gatewayFailure("upload", "unavailable"));
          const decoded = Schema.decodeUnknownEither(PublishedMediaUploadResponseSchema)(
            response.body,
          );
          return Either.isRight(decoded) && sameReference(decoded.right.reference, asset.reference)
            ? Effect.void
            : Effect.fail(gatewayFailure("upload", "unavailable"));
        }),
      );
    },

    read(reference) {
      const decodedReference = Schema.decodeUnknownEither(MediaReferenceSchema)(reference);
      if (Either.isLeft(decodedReference))
        return Effect.fail(gatewayFailure("read", "invalid-media"));
      const validReference = decodedReference.right;
      return transport({
        method: "GET",
        path: `/api/v1/workspace/media/${encodeURIComponent(validReference.id)}`,
        headers: { "x-recall-media-reference": JSON.stringify(validReference) },
        responseType: "bytes",
      }).pipe(
        Effect.mapError(() => gatewayFailure("read", "unavailable")),
        Effect.flatMap((response) => {
          if (response.status === 409)
            return Effect.fail(gatewayFailure("read", "account-changed"));
          if (response.status === 404) return Effect.succeed(null);
          if (
            response.status < 200 ||
            response.status >= 300 ||
            !(response.body instanceof Uint8Array)
          ) {
            return Effect.fail(gatewayFailure("read", "unavailable"));
          }
          const asset = { reference: validReference, bytes: response.body.slice() };
          return verifyMediaAsset(asset)
            ? Effect.succeed(asset)
            : Effect.fail(gatewayFailure("read", "invalid-media"));
        }),
      );
    },
  };
}

/**
 * Synchronize each referenced asset once. Local assets are verified before upload; absent local
 * assets are fetched, verified by the gateway and persisted. Failed batches retain successful
 * writes for retry because another workspace commit may already reference those assets.
 */
export function syncWorkspaceMedia(
  mediaStore: MediaStore,
  gateway: WorkspaceMediaGateway,
  references: readonly MediaReference[],
): Effect.Effect<void, WorkspaceMediaSyncFailure> {
  return Effect.gen(function* () {
    const unique = new Map<string, MediaReference>();
    for (const reference of references) {
      const decoded = Schema.decodeUnknownEither(MediaReferenceSchema)(reference);
      if (Either.isLeft(decoded)) return yield* Effect.fail(syncFailure("invalid-reference"));
      const current = unique.get(decoded.right.id);
      if (current && !sameReference(current, decoded.right))
        return yield* Effect.fail(syncFailure("invalid-reference"));
      unique.set(decoded.right.id, decoded.right);
    }

    const downloads: StoredMediaAsset[] = [];
    for (const reference of unique.values()) {
      const local = yield* mediaStore
        .get(reference.id)
        .pipe(Effect.mapError(() => syncFailure("local-store-unavailable")));
      if (local) {
        if (!sameReference(local.reference, reference) || !verifyMediaAsset(local))
          return yield* Effect.fail(syncFailure("invalid-media"));
        yield* gateway
          .upload(local)
          .pipe(
            Effect.mapError((error) =>
              syncFailure(
                error.reason === "account-changed"
                  ? "account-changed"
                  : error.reason === "invalid-media"
                    ? "invalid-media"
                    : "cloud-unavailable",
              ),
            ),
          );
        continue;
      }

      const remote = yield* gateway
        .read(reference)
        .pipe(
          Effect.mapError((error) =>
            syncFailure(
              error.reason === "account-changed"
                ? "account-changed"
                : error.reason === "invalid-media"
                  ? "invalid-media"
                  : "cloud-unavailable",
            ),
          ),
        );
      if (!remote) return yield* Effect.fail(syncFailure("media-not-found"));
      if (!sameReference(remote.reference, reference) || !verifyMediaAsset(remote))
        return yield* Effect.fail(syncFailure("invalid-media"));
      downloads.push(remote);
    }

    yield* persistMediaAssets(mediaStore, downloads).pipe(
      Effect.mapError(() => syncFailure("persistence-failed")),
    );
  });
}
