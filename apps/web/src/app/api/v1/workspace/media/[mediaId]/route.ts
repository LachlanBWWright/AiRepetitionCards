import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import {
  supabaseApiAuthFailureStatus,
  type SupabaseApiContextErrorReason,
} from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { readBinaryBody } from "@/lib/http/read-binary-body";
import {
  MediaReferenceRouteRequestSchema,
  PublishedMediaUploadResponseSchema,
} from "@recall/contracts";
import { verifyMediaAsset } from "@recall/application";
import { createClient } from "@supabase/supabase-js";
import type { RecallSupabaseClient } from "@recall/infra-supabase";
import {
  downloadWorkspaceMedia,
  uploadWorkspaceMedia,
} from "@recall/infra-supabase/workspace-media";
import type { Database } from "@recall/infra-supabase/database.types";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readSupabaseConfig } from "@/lib/supabase/config";

type RouteContext = { readonly params: Promise<{ readonly mediaId: string }> };

const maxMediaBytes = 20_000_000;

function authFailure(reason: SupabaseApiContextErrorReason): NextResponse {
  const status = supabaseApiAuthFailureStatus(reason);
  return privateJson({ error: reason }, { status });
}

function getStorageClient(
  request: NextRequest,
  fallback: RecallSupabaseClient,
): RecallSupabaseClient {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) return fallback;
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return fallback;
  return createClient<Database>(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
}

function readReference(raw: string | null, mediaId: string) {
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => JSON.parse(raw ?? "null") as unknown,
        catch: () => ({ _tag: "ReferenceHeaderInvalid" }) as const,
      }),
    ),
  );
  if (Either.isLeft(parsed)) return null;
  const decoded = Schema.decodeUnknownEither(MediaReferenceRouteRequestSchema)({
    mediaId,
    reference: parsed.right,
  });
  return Either.isRight(decoded) && decoded.right.reference.id === mediaId
    ? decoded.right.reference
    : null;
}

async function handleGET(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") return authFailure(auth.reason);
  const limited = await authenticatedApiRateLimit(auth.userId, "review-sync", {
    request,
    namespace: "media-read",
  });
  if (limited) return limited;
  const storageClient = getStorageClient(request, auth.client);
  const { mediaId } = await context.params;
  const reference = readReference(request.headers.get("x-recall-media-reference"), mediaId);
  if (!reference) return privateJson({ error: "invalid-media-reference" }, { status: 400 });
  const downloaded = await Effect.runPromise(
    Effect.either(downloadWorkspaceMedia(storageClient, auth.userId, mediaId)),
  );
  if (Either.isLeft(downloaded)) {
    return privateJson({ error: "media-not-found" }, { status: 404 });
  }
  const bytes = downloaded.right;
  if (!verifyMediaAsset({ reference, bytes })) {
    return privateJson({ error: "media-integrity-failed" }, { status: 422 });
  }
  const responseBytes = new Uint8Array(bytes.byteLength);
  responseBytes.set(bytes);
  return new Response(responseBytes.buffer, {
    status: 200,
    headers: {
      "Content-Type": reference.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handlePOST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") return authFailure(auth.reason);
  const limited = await authenticatedApiRateLimit(auth.userId, "review-sync", {
    request,
    namespace: "media-write",
  });
  if (limited) return limited;
  const storageClient = getStorageClient(request, auth.client);
  const { mediaId } = await context.params;
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (
    contentLength !== null &&
    (!Number.isFinite(contentLength) || contentLength > maxMediaBytes)
  ) {
    return privateJson({ error: "media-too-large" }, { status: 413 });
  }
  const reference = readReference(request.headers.get("x-recall-media-reference"), mediaId);
  if (!reference) {
    return privateJson({ error: "invalid-media-reference" }, { status: 400 });
  }
  const body = await Effect.runPromise(Effect.either(readBinaryBody(request, maxMediaBytes)));
  if (Either.isLeft(body) && body.left.reason === "too-large") {
    return privateJson({ error: "media-too-large" }, { status: 413 });
  }
  if (Either.isLeft(body) && body.left.reason === "unsupported-media-type") {
    return privateJson({ error: "unsupported-media-type" }, { status: 415 });
  }
  if (Either.isLeft(body)) return privateJson({ error: "media-read-failed" }, { status: 400 });
  const asset = { reference, bytes: body.right };
  if (!verifyMediaAsset(asset)) {
    return privateJson({ error: "media-integrity-failed" }, { status: 422 });
  }

  const storage = await Effect.runPromise(
    Effect.either(
      uploadWorkspaceMedia(storageClient, auth.userId, mediaId, reference.mimeType, asset.bytes),
    ),
  );
  if (Either.isLeft(storage)) {
    return privateJson({ error: "media-storage-unavailable" }, { status: 502 });
  }
  let created = true;
  if (storage.right === "AlreadyExists") {
    const existing = await Effect.runPromise(
      Effect.either(downloadWorkspaceMedia(storageClient, auth.userId, mediaId)),
    );
    if (Either.isLeft(existing) || !verifyMediaAsset({ reference, bytes: existing.right })) {
      return privateJson({ error: "media-storage-conflict" }, { status: 409 });
    }
    created = false;
  }
  const response = Schema.decodeUnknownEither(PublishedMediaUploadResponseSchema)({ reference });
  return Either.isLeft(response)
    ? privateJson({ error: "media-response-invalid" }, { status: 502 })
    : privateJson(response.right, { status: created ? 201 : 200 });
}

export const GET = observeRoute("workspace-media-read", handleGET);

export const POST = observeRoute("workspace-media-write", handlePOST);
