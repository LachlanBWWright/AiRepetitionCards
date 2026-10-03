import { Effect, Either, Schema } from "effect";
import {
  ForkPublishedKnowledgeAreaRequestSchema,
  ForkPublishedKnowledgeAreaResponseSchema,
  PublicationVersionIdSchema,
  PublishKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaRequestSchema,
  CheckPublicationUpdatesRequestSchema,
  CheckPublicationUpdatesResponseSchema,
  PublishingErrorResponseSchema,
  type PublishingErrorCode,
  RotatePublishedShareTokenRequestSchema,
  RotatePublishedShareTokenResponseSchema,
} from "@recall/contracts";
import { preparePublication } from "./publication-fork";
import { publicationContentHash } from "./publication-content-hash";

export type PublishingHttpRequest = {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
};

export type PublishingHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type PublishingTransportFailure = { readonly _tag: "PublishingTransportFailure" };
export type PublishingTransport = (
  request: PublishingHttpRequest,
) => Effect.Effect<PublishingHttpResponse, PublishingTransportFailure>;

export type PublishingApiFailure =
  | PublishingTransportFailure
  | {
      readonly _tag: "PublishingApiFailure";
      readonly reason: "http";
      readonly status: number;
      readonly code: PublishingErrorCode | null;
    }
  | {
      readonly _tag: "PublishingApiFailure";
      readonly reason: "invalid-request" | "invalid-response";
    };

function errorCode(body: unknown): PublishingErrorCode | null {
  const decoded = Schema.decodeUnknownEither(PublishingErrorResponseSchema)(body);
  return Either.isRight(decoded) ? decoded.right.error : null;
}

function decodeResponse<A, I>(
  response: PublishingHttpResponse,
  schema: Schema.Schema<A, I>,
  matchesRequest: (value: A) => boolean = () => true,
): Effect.Effect<A, PublishingApiFailure> {
  if (response.status < 200 || response.status >= 300) {
    return Effect.fail({
      _tag: "PublishingApiFailure",
      reason: "http",
      status: response.status,
      code: errorCode(response.body),
    });
  }
  const decoded = Schema.decodeUnknownEither(schema)(response.body);
  return Either.isLeft(decoded) || !matchesRequest(decoded.right)
    ? Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-response" })
    : Effect.succeed(decoded.right);
}

export function createPublishingApi(transport: PublishingTransport) {
  return {
    checkUpdates(input: unknown) {
      const request = Schema.decodeUnknownEither(CheckPublicationUpdatesRequestSchema)(input);
      if (Either.isLeft(request))
        return Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-request" } as const);
      const query = new URLSearchParams();
      if (request.right.sourceAreaId) query.set("sourceAreaId", request.right.sourceAreaId);
      if (request.right.shareToken) query.set("token", request.right.shareToken);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return transport({
        method: "GET",
        path: `/api/v1/published/${request.right.versionId}/updates${suffix}`,
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(
            response,
            CheckPublicationUpdatesResponseSchema,
            (value) =>
              value.knownVersion.id === request.right.versionId &&
              (request.right.sourceAreaId === undefined ||
                value.knownVersion.sourceAreaId === request.right.sourceAreaId) &&
              (value.latestPublicVersion === null ||
                (value.latestPublicVersion.sourceAreaId === value.knownVersion.sourceAreaId &&
                  value.latestPublicVersion.id !== value.knownVersion.id &&
                  value.latestPublicVersion.version > value.knownVersion.version)),
          ),
        ),
      );
    },
    publish(input: unknown) {
      const request = Effect.runSync(Effect.either(preparePublication(input)));
      if (Either.isLeft(request))
        return Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-request" } as const);
      return transport({
        method: "POST",
        path: "/api/v1/knowledge-areas",
        body: { ...request.right, schemaVersion: 1 },
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(
            response,
            PublishKnowledgeAreaResponseSchema,
            (value) =>
              value.operationId === request.right.operationId &&
              value.version.contentHash.toLowerCase() ===
                publicationContentHash(value.version.content) &&
              publicationContentHash(value.version.content) ===
                publicationContentHash(request.right.content) &&
              value.version.content.id === request.right.sourceAreaId &&
              (value.version.sourceAreaId === undefined ||
                value.version.sourceAreaId === request.right.sourceAreaId) &&
              (value.version.visibility === undefined ||
                value.version.visibility === request.right.visibility) &&
              value.version.forkedFromVersionId === request.right.forkedFromVersionId &&
              value.version.license === request.right.license &&
              value.version.attribution === request.right.attribution,
          ),
        ),
      );
    },

    read(versionId: unknown, token?: unknown) {
      const request = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaRequestSchema)({
        versionId,
        shareToken: token ?? null,
      });
      if (Either.isLeft(request))
        return Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-request" } as const);
      const { shareToken } = request.right;
      const suffix = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      return transport({
        method: "GET",
        path: `/api/v1/published/${request.right.versionId}${suffix}`,
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(
            response,
            ReadPublishedKnowledgeAreaResponseSchema,
            (value) =>
              value.version.id === request.right.versionId &&
              value.version.contentHash.toLowerCase() ===
                publicationContentHash(value.version.content),
          ),
        ),
      );
    },

    fork(versionId: unknown, operationId: unknown, token?: unknown) {
      const id = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
      const request = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaRequestSchema)({
        operationId,
        ...(token === undefined ? {} : { shareToken: token }),
      });
      if (Either.isLeft(id) || Either.isLeft(request))
        return Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-request" } as const);
      return transport({
        method: "POST",
        path: `/api/v1/published/${id.right}/fork`,
        body: { ...request.right, schemaVersion: 1 },
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(
            response,
            ForkPublishedKnowledgeAreaResponseSchema,
            (value) =>
              value.operationId === request.right.operationId &&
              value.contentHash.toLowerCase() === publicationContentHash(value.document) &&
              value.forkedFromVersionId === id.right &&
              value.document.id === value.areaId &&
              value.document.forkedFromVersionId?.toLowerCase() === id.right,
          ),
        ),
      );
    },

    manageShareToken(versionId: unknown, action: unknown) {
      const id = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
      const request = Schema.decodeUnknownEither(RotatePublishedShareTokenRequestSchema)({
        action,
      });
      if (Either.isLeft(id) || Either.isLeft(request))
        return Effect.fail({ _tag: "PublishingApiFailure", reason: "invalid-request" } as const);
      return transport({
        method: "PATCH",
        path: `/api/v1/published/${id.right}/token`,
        body: { ...request.right, schemaVersion: 1 },
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(
            response,
            RotatePublishedShareTokenResponseSchema,
            (value) =>
              value.versionId === id.right &&
              (request.right.action === "revoke" ? value.token === null : value.token !== null),
          ),
        ),
      );
    },
  };
}

export type PublishingApi = ReturnType<typeof createPublishingApi>;
