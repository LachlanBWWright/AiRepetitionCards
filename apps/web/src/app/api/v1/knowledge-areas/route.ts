import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import {
  PublishKnowledgeAreaRequestSchema,
  PublishKnowledgeAreaResponseSchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import {
  verifyMediaAsset,
  preparePublication,
  publicationOperationIdentity,
  publicationRequestFingerprint,
} from "@recall/application";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import {
  publishKnowledgeArea,
  readPublicationMedia,
  readPublicationOperation,
} from "@recall/infra-supabase/knowledge-area-publication";
import { readJsonBody } from "@/lib/http/read-json";
import { contentHash, parsePortableArea, hashShareToken } from "@/lib/publishing/shared";

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return publishingErrorResponse(auth.reason, status);
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", {
    request,
    namespace: "publication-write",
    publication: true,
  });
  if (limited) return limited;
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 1_000_000)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return publishingErrorResponse(
      tooLarge ? "request-too-large" : "invalid-request",
      tooLarge ? 413 : 400,
    );
  }
  const requestValue = Schema.decodeUnknownEither(PublishKnowledgeAreaRequestSchema)(body.right);
  if (Either.isLeft(requestValue)) {
    return publishingErrorResponse("invalid-request", 400);
  }
  const prepared = Effect.runSync(Effect.either(preparePublication(requestValue.right)));
  if (Either.isLeft(prepared))
    return publishingErrorResponse(
      prepared.left.reason === "lineage-mismatch"
        ? "publication-lineage-mismatch"
        : prepared.left.reason === "rights-required"
          ? "publication-rights-required"
          : "invalid-publication",
      400,
    );
  const { sourceAreaId, visibility, attribution, license, forkedFromVersionId } = prepared.right;
  const area = parsePortableArea(prepared.right.content);
  if (area === null || area.id !== sourceAreaId) {
    return publishingErrorResponse("invalid-publication", 400);
  }

  const { client, userId } = auth;
  const identity = await Effect.runPromise(
    Effect.either(publicationOperationIdentity(userId, prepared.right)),
  );
  if (Either.isLeft(identity)) return publishingErrorResponse("invalid-publication", 400);
  const token = prepared.right.shareToken ?? null;
  const recover = async (): Promise<NextResponse | null> => {
    const existing = await Effect.runPromise(
      Effect.either(readPublicationOperation(client, userId, identity.right.versionId)),
    );
    if (Either.isLeft(existing)) return publishingErrorResponse("publication-unavailable", 502);
    if (existing.right === null) return null;
    const decoded = Schema.decodeUnknownEither(
      Schema.Struct({
        id: Schema.String,
        source_area_id: Schema.String,
        owner_id: Schema.String,
        version: Schema.Number,
        content: Schema.Unknown,
        content_hash: Schema.String,
        visibility: Schema.Literal("private", "public", "unlisted"),
        attribution: Schema.NullOr(Schema.String),
        license: Schema.NullOr(Schema.String),
        forked_from_version_id: Schema.NullOr(Schema.String),
        created_at: Schema.String,
        share_token_hash: Schema.NullOr(Schema.String),
      }),
    )(existing.right);
    if (Either.isLeft(decoded)) return publishingErrorResponse("publication-response-invalid", 502);
    const row = decoded.right;
    const previous = Effect.runSync(
      Effect.either(
        preparePublication({
          operationId: prepared.right.operationId,
          sourceAreaId: row.source_area_id,
          content: row.content,
          visibility: row.visibility,
          attribution: row.attribution,
          license: row.license,
          forkedFromVersionId: row.forked_from_version_id,
          reuseConfirmed: true,
          ...(row.visibility === "unlisted" && token ? { shareToken: token } : {}),
        }),
      ),
    );
    if (
      Either.isLeft(previous) ||
      row.owner_id.toLowerCase() !== userId.toLowerCase() ||
      row.id !== identity.right.versionId ||
      publicationRequestFingerprint(previous.right) !== identity.right.fingerprint ||
      contentHash(previous.right.content) !== row.content_hash
    )
      return publishingErrorResponse("publication-operation-conflict", 409);
    const activeToken = token && row.share_token_hash === hashShareToken(token) ? token : null;
    const response = Schema.decodeUnknownEither(PublishKnowledgeAreaResponseSchema)({
      schemaVersion: 1,
      operationId: prepared.right.operationId,
      version: {
        id: row.id,
        sourceAreaId: row.source_area_id,
        version: row.version,
        content: previous.right.content,
        contentHash: row.content_hash,
        visibility: row.visibility,
        attribution: row.attribution,
        license: row.license,
        forkedFromVersionId: row.forked_from_version_id,
        createdAt: row.created_at,
      },
      ...(activeToken ? { shareToken: activeToken } : {}),
    });
    return Either.isLeft(response)
      ? publishingErrorResponse("publication-response-invalid", 502)
      : privateJson(response.right);
  };
  const recovered = await recover();
  if (recovered) return recovered;
  const mediaReferences = [
    ...new Map(
      area.cards.flatMap((card) => card.media ?? []).map((reference) => [reference.id, reference]),
    ).values(),
  ];
  const totalMediaBytes = mediaReferences.reduce(
    (total, reference) => total + reference.byteLength,
    0,
  );
  if (mediaReferences.length > 128 || totalMediaBytes > 40_000_000) {
    return publishingErrorResponse("media-limits-exceeded", 413);
  }
  for (const reference of mediaReferences) {
    const downloadResult = await Effect.runPromise(
      Effect.either(readPublicationMedia(client, userId, reference.id)),
    );
    if (Either.isLeft(downloadResult)) {
      return publishingErrorResponse("media-storage-unavailable", 502);
    }
    const downloaded = downloadResult.right;
    if (downloaded._tag === "Missing") {
      return publishingErrorResponse("media-not-uploaded", 422);
    }
    if (!verifyMediaAsset({ reference, bytes: downloaded.bytes })) {
      return publishingErrorResponse("media-integrity-failed", 422);
    }
  }
  const databaseContent = await Effect.runPromise(Effect.either(toDatabaseJson(area)));
  if (Either.isLeft(databaseContent)) return publishingErrorResponse("invalid-publication", 400);
  const content = databaseContent.right;
  if (content === null) return publishingErrorResponse("invalid-publication", 400);
  const saved = await Effect.runPromise(
    Effect.either(
      publishKnowledgeArea(client, {
        id: identity.right.versionId,
        sourceAreaId,
        ownerId: userId,
        content,
        contentHash: contentHash(area),
        visibility,
        attribution,
        license,
        forkedFromVersionId,
        shareTokenHash: token ? hashShareToken(token) : null,
      }),
    ),
  );
  if (Either.isLeft(saved)) {
    const recoveredAfterSave = await recover();
    if (recoveredAfterSave) return recoveredAfterSave;
    switch (saved.left._tag) {
      case "KnowledgeAreaPublicationUnavailable":
        return publishingErrorResponse("publication-unavailable", 502);
      case "KnowledgeAreaVersionConflict":
        return publishingErrorResponse("version-conflict", 409);
      case "KnowledgeAreaPublicationSaveFailed":
        return publishingErrorResponse("publication-save-failed", 502);
    }
  }
  switch (saved.right._tag) {
    case "AreaNotFound":
      return publishingErrorResponse("area-not-found", 404);
    case "SourceVersionNotFound":
      return publishingErrorResponse("source-version-not-found", 404);
    case "Published":
      break;
  }
  const inserted = Schema.decodeUnknownEither(
    Schema.Struct({
      id: Schema.String,
      source_area_id: Schema.String,
      version: Schema.Number,
      content_hash: Schema.String,
      visibility: Schema.Literal("private", "public", "unlisted"),
      attribution: Schema.NullOr(Schema.String),
      license: Schema.NullOr(Schema.String),
      forked_from_version_id: Schema.NullOr(Schema.String),
      created_at: Schema.String,
    }),
  )(saved.right.row);
  if (Either.isLeft(inserted)) return publishingErrorResponse("publication-save-failed", 502);
  const response = Schema.decodeUnknownEither(PublishKnowledgeAreaResponseSchema)({
    schemaVersion: 1,
    operationId: prepared.right.operationId,
    version: {
      id: inserted.right.id,
      sourceAreaId: inserted.right.source_area_id,
      version: inserted.right.version,
      content: area,
      contentHash: inserted.right.content_hash,
      visibility: inserted.right.visibility,
      attribution: inserted.right.attribution,
      license: inserted.right.license,
      forkedFromVersionId: inserted.right.forked_from_version_id,
      createdAt: inserted.right.created_at,
    },
    ...(token ? { shareToken: token } : {}),
  });
  return Either.isLeft(response)
    ? publishingErrorResponse("publication-response-invalid", 502)
    : privateJson(response.right, { status: 201 });
}

export const POST = observeRoute("publication-create", handlePOST);
