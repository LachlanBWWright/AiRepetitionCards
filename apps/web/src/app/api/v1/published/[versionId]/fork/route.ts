import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import {
  ForkPublishedKnowledgeAreaRequestSchema,
  ForkPublishedKnowledgeAreaResponseSchema,
  PublicationVersionIdSchema,
  PublishedShareTokenQuerySchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import {
  readPublishedForkSource,
  readExistingPublishedFork,
  savePublishedFork,
} from "@recall/infra-supabase/published-fork";
import {
  publicationForkIdentity,
  createPublicationFork,
  PublicationForkIdKind,
} from "@recall/application";
import { readJsonBody } from "@/lib/http/read-json";
import {
  contentHash,
  hashShareToken,
  parsePortableArea,
  parsePublishedVersionRow,
} from "@/lib/publishing/shared";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };

async function handlePOST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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
  const { versionId } = await context.params;
  const decodedVersionId = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
  if (Either.isLeft(decodedVersionId))
    return publishingErrorResponse("source-version-not-found", 404);
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 4_096)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return publishingErrorResponse(
      tooLarge ? "request-too-large" : "invalid-request",
      tooLarge ? 413 : 400,
    );
  }
  const requestBody = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaRequestSchema)(
    body.right,
  );
  if (Either.isLeft(requestBody)) {
    return publishingErrorResponse("invalid-request", 400);
  }
  const tokenValues = request.nextUrl.searchParams.getAll("token");
  const decodedTokenQuery = Schema.decodeUnknownEither(PublishedShareTokenQuerySchema)({
    ...(tokenValues.length === 1 ? { token: tokenValues[0] } : {}),
    ...(tokenValues.length > 1 ? { token: tokenValues } : {}),
  });
  if (Either.isLeft(decodedTokenQuery)) {
    return publishingErrorResponse("invalid-share-token", 400);
  }
  const shareToken = requestBody.right.shareToken ?? decodedTokenQuery.right.token ?? null;

  const identity = Effect.runSync(
    Effect.either(
      publicationForkIdentity({
        ownerId: auth.userId,
        operationId: requestBody.right.operationId,
        sourceVersionId: decodedVersionId.right,
      }),
    ),
  );
  if (Either.isLeft(identity)) return publishingErrorResponse("invalid-request", 400);
  const recoveredResponse = async (): Promise<NextResponse | null> => {
    const existing = await Effect.runPromise(
      Effect.either(
        readExistingPublishedFork(
          auth.client,
          auth.userId,
          identity.right.areaId,
          identity.right.initialVersionId,
        ),
      ),
    );
    if (Either.isLeft(existing)) return publishingErrorResponse("fork-save-failed", 502);
    if (existing.right._tag === "Missing") return null;
    if (existing.right._tag === "Deleted")
      return publishingErrorResponse("fork-operation-conflict", 409);
    const row = Schema.decodeUnknownEither(
      Schema.Struct({
        id: Schema.String,
        knowledge_area_id: Schema.String,
        created_by: Schema.String,
        content: Schema.Unknown,
        content_hash: Schema.String,
      }),
    )(existing.right.row);
    const savedDocument = Either.isRight(row) ? parsePortableArea(row.right.content) : null;
    if (
      Either.isLeft(row) ||
      !savedDocument ||
      row.right.id !== identity.right.initialVersionId ||
      row.right.created_by.toLowerCase() !== auth.userId.toLowerCase() ||
      row.right.knowledge_area_id !== identity.right.areaId ||
      savedDocument.id !== identity.right.areaId ||
      savedDocument.forkedFromVersionId?.toLowerCase() !== decodedVersionId.right ||
      contentHash(savedDocument) !== row.right.content_hash
    )
      return publishingErrorResponse("fork-operation-conflict", 409);
    const response = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaResponseSchema)({
      schemaVersion: 1,
      operationId: requestBody.right.operationId,
      saved: true,
      areaId: savedDocument.id,
      contentHash: row.right.content_hash,
      document: savedDocument,
      attribution: savedDocument.attribution ?? null,
      license: savedDocument.licence,
      forkedFromVersionId: decodedVersionId.right,
    });
    return Either.isLeft(response)
      ? publishingErrorResponse("fork-response-invalid", 502)
      : privateJson(response.right);
  };
  const recovered = await recoveredResponse();
  if (recovered) return recovered;

  const sourceResult = await Effect.runPromise(
    Effect.either(
      readPublishedForkSource(
        auth.client,
        decodedVersionId.right,
        typeof shareToken === "string" ? hashShareToken(shareToken) : null,
      ),
    ),
  );
  const source =
    Either.isRight(sourceResult) && sourceResult.right._tag === "Found"
      ? parsePublishedVersionRow(sourceResult.right.row)
      : null;
  if (!source || source.content === undefined) {
    return publishingErrorResponse("source-version-not-found", 404);
  }
  const sourceArea = parsePortableArea(source.content);
  if (
    sourceArea === null ||
    source.content_hash === undefined ||
    contentHash(sourceArea) !== source.content_hash
  ) {
    return publishingErrorResponse("source-version-invalid", 502);
  }
  const attribution = typeof source.attribution === "string" ? source.attribution : null;
  const license = typeof source.license === "string" ? source.license : null;
  const generated = Effect.runSync(
    Effect.either(
      createPublicationFork({
        ownerId: auth.userId,
        operationId: requestBody.right.operationId,
        sourceVersionId: decodedVersionId.right,
        source: sourceArea,
        attribution,
        license,
      }),
    ),
  );
  if (Either.isLeft(generated)) return publishingErrorResponse("fork-generation-failed", 502);
  const document = generated.right.document;
  const areaPayload = {
    id: document.id,
    title: document.title,
    description: document.description,
    language: document.language,
    color: "#5965d8",
    tags: document.tags,
    objectives: document.objectives,
    cards: document.cards.map((card) => ({
      ...card,
      revisionId: generated.right.id(PublicationForkIdKind.CardRevision, card.id),
    })),
    document,
    versionId: generated.right.initialVersionId,
    contentHash: contentHash(document),
    baseContentHash: null,
  };
  const databasePayload = await Effect.runPromise(Effect.either(toDatabaseJson([areaPayload])));
  if (Either.isLeft(databasePayload)) return publishingErrorResponse("fork-generation-failed", 502);
  const databaseTombstones = await Effect.runPromise(Effect.either(toDatabaseJson([])));
  if (Either.isLeft(databaseTombstones))
    return publishingErrorResponse("fork-generation-failed", 502);
  const saved = await Effect.runPromise(
    Effect.either(
      savePublishedFork(
        auth.client,
        auth.userId,
        document.id,
        databasePayload.right,
        databaseTombstones.right,
      ),
    ),
  );
  if (Either.isLeft(saved) || saved.right !== "Saved") {
    const recoveredAfterSave = await recoveredResponse();
    if (recoveredAfterSave) return recoveredAfterSave;
    return publishingErrorResponse(
      Either.isLeft(saved) ? "fork-save-failed" : "fork-save-conflict",
      Either.isLeft(saved) ? 502 : 409,
    );
  }
  const response = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaResponseSchema)({
    schemaVersion: 1,
    operationId: requestBody.right.operationId,
    saved: true,
    areaId: document.id,
    contentHash: contentHash(document),
    document,
    attribution: document.attribution ?? null,
    license: document.licence,
    forkedFromVersionId: decodedVersionId.right,
  });
  return Either.isLeft(response)
    ? publishingErrorResponse("fork-response-invalid", 502)
    : privateJson(response.right, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
}

export const POST = observeRoute("publication-fork", handlePOST);
