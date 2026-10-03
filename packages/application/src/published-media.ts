import { Effect, Either, Schema } from "effect";
import {
  PublishedMediaReadRequestSchema,
  PublishedMediaUploadResponseSchema,
} from "@recall/contracts";
import { MediaReferenceSchema, type MediaReference } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { verifyMediaAsset } from "./knowledge-area-package";

export type PublishedMediaFailure = {
  readonly _tag: "PublishedMediaFailure";
  readonly operation: "upload" | "read";
  readonly reason: "unavailable" | "invalid-media";
};

/** Platform-neutral port for sharing verified media with immutable publications. */
export type PublishedMediaGateway = {
  readonly upload: (asset: StoredMediaAsset) => Effect.Effect<void, PublishedMediaFailure>;
  readonly read: (
    versionId: string,
    reference: MediaReference,
    token?: string,
  ) => Effect.Effect<StoredMediaAsset | null, PublishedMediaFailure>;
};

export type PublishedMediaHttpRequest = {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly responseType: "json" | "bytes";
};

export type PublishedMediaHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type PublishedMediaTransportFailure = { readonly _tag: "PublishedMediaTransportFailure" };
export type PublishedMediaTransport = (
  request: PublishedMediaHttpRequest,
) => Effect.Effect<PublishedMediaHttpResponse, PublishedMediaTransportFailure>;

const failure = (
  operation: PublishedMediaFailure["operation"],
  reason: PublishedMediaFailure["reason"],
): PublishedMediaFailure => ({ _tag: "PublishedMediaFailure", operation, reason });

/**
 * Shared verified media gateway. Each platform supplies bounded HTTP/binary transport; request
 * validation, response decoding, not-found behavior, and content-hash verification stay shared.
 */
export function createPublishedMediaGateway(
  transport: PublishedMediaTransport,
): PublishedMediaGateway {
  return {
    upload(asset) {
      if (!verifyMediaAsset(asset)) return Effect.fail(failure("upload", "invalid-media"));
      return transport({
        method: "POST",
        path: `/api/v1/publishing/media/${asset.reference.id}`,
        headers: {
          "content-type": "application/octet-stream",
          "x-recall-media-reference": JSON.stringify(asset.reference),
        },
        body: asset.bytes.slice(),
        responseType: "json",
      }).pipe(
        Effect.mapError(() => failure("upload", "unavailable")),
        Effect.flatMap((response) => {
          if (response.status < 200 || response.status >= 300)
            return Effect.fail(failure("upload", "unavailable"));
          const decoded = Schema.decodeUnknownEither(PublishedMediaUploadResponseSchema)(
            response.body,
          );
          return Either.isRight(decoded) && decoded.right.reference.id === asset.reference.id
            ? Effect.void
            : Effect.fail(failure("upload", "unavailable"));
        }),
      );
    },

    read(versionId, reference, token) {
      const decodedReference = Schema.decodeUnknownEither(MediaReferenceSchema)(reference);
      const decodedToken = Schema.decodeUnknownEither(PublishedMediaReadRequestSchema)(
        token === undefined ? {} : { token },
      );
      if (Either.isLeft(decodedReference) || Either.isLeft(decodedToken))
        return Effect.fail(failure("read", "invalid-media"));
      const tokenValue = decodedToken.right.token;
      const query = tokenValue ? `?token=${encodeURIComponent(tokenValue)}` : "";
      return transport({
        method: "GET",
        path: `/api/v1/published/${encodeURIComponent(versionId)}/media/${decodedReference.right.id}${query}`,
        headers: { "x-recall-media-reference": JSON.stringify(decodedReference.right) },
        responseType: "bytes",
      }).pipe(
        Effect.mapError(() => failure("read", "unavailable")),
        Effect.flatMap((response) => {
          if (response.status === 404) return Effect.succeed(null);
          if (
            response.status < 200 ||
            response.status >= 300 ||
            !(response.body instanceof Uint8Array)
          ) {
            return Effect.fail(failure("read", "unavailable"));
          }
          const asset = { reference: decodedReference.right, bytes: response.body.slice() };
          return verifyMediaAsset(asset)
            ? Effect.succeed(asset)
            : Effect.fail(failure("read", "invalid-media"));
        }),
      );
    },
  };
}
