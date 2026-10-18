import { Buffer } from "node:buffer";
import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { MediaReference } from "@recall/domain";
import { verifyMediaAsset } from "@recall/application";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IpcMainInvokeEvent } from "electron";
import type { DesktopMediaResponse, DesktopReply } from "./desktop-services";

const DesktopMediaRequestSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(512)),
  method: Schema.Union(Schema.Literal("GET"), Schema.Literal("POST")),
  referenceJson: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_048))),
  bytes: Schema.NullOr(Schema.Uint8ArrayFromSelf),
  expectedOwnerId: Schema.optional(Schema.UUID),
});
const maxPublishedMediaBytes = 20_000_000;
const apiRequestTimeoutMs = 60_000;
const publishedMediaGetPattern =
  /^\/api\/v1\/published\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/media\/([a-f0-9]{64})(?:\?token=([A-Za-z0-9_-]{43}))?$/i;
const publishedMediaPostPattern = /^\/api\/v1\/publishing\/media\/([a-f0-9]{64})$/;
const workspaceMediaPattern = /^\/api\/v1\/workspace\/media\/([a-f0-9]{64})$/;
type DesktopMediaRequest = typeof DesktopMediaRequestSchema.Type;
type ApiFailure = { readonly _tag: "DesktopApiFailure" };

function failure<T>(): DesktopReply<T> {
  return { _tag: "Failure" };
}

export function createDesktopMediaRequestHandler(
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
  authClient: SupabaseClient | null,
  recallApiUrl: string | undefined,
  currentAccessToken: () => Promise<string | null>,
): (event: IpcMainInvokeEvent, input: unknown) => Promise<DesktopReply<DesktopMediaResponse>> {
  return async (event, input) => {
    if (!trustedSender(event) || !authClient || !recallApiUrl) return failure();
    const decoded = Schema.decodeUnknownEither(DesktopMediaRequestSchema)(input);
    if (Either.isLeft(decoded)) return failure();
    const mediaRequest: DesktopMediaRequest = decoded.right;
    const parsedReference = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => JSON.parse(mediaRequest.referenceJson ?? "null") as unknown,
          catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
        }),
      ),
    );
    if (Either.isLeft(parsedReference)) return failure();
    const referenceResult = Schema.decodeUnknownEither(MediaReferenceSchema)(parsedReference.right);
    if (Either.isLeft(referenceResult)) return failure();
    const reference: MediaReference = referenceResult.right;

    if (mediaRequest.method === "GET") {
      const publishedMatch = publishedMediaGetPattern.exec(mediaRequest.path);
      const workspaceMatch = workspaceMediaPattern.exec(mediaRequest.path);
      const mediaId = publishedMatch?.[2] ?? workspaceMatch?.[1];
      if (!mediaId || mediaRequest.bytes !== null || mediaId !== reference.id) return failure();
    } else {
      const match =
        publishedMediaPostPattern.exec(mediaRequest.path) ??
        workspaceMediaPattern.exec(mediaRequest.path);
      if (
        !match ||
        match[1] !== reference.id ||
        mediaRequest.bytes === null ||
        mediaRequest.bytes.byteLength > maxPublishedMediaBytes ||
        mediaRequest.bytes.byteLength !== reference.byteLength ||
        !verifyMediaAsset({ reference, bytes: mediaRequest.bytes })
      ) {
        return failure();
      }
    }

    const baseUrl = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => new URL(recallApiUrl),
          catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
        }),
      ),
    );
    if (Either.isLeft(baseUrl)) return failure();
    const loopback =
      baseUrl.right.hostname === "localhost" ||
      baseUrl.right.hostname === "127.0.0.1" ||
      baseUrl.right.hostname === "[::1]";
    if (baseUrl.right.protocol !== "https:" && !(baseUrl.right.protocol === "http:" && loopback)) {
      return failure();
    }
    const targetUrl = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => new URL(mediaRequest.path, baseUrl.right),
          catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
        }),
      ),
    );
    if (Either.isLeft(targetUrl) || targetUrl.right.origin !== baseUrl.right.origin) {
      return failure();
    }

    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async (): Promise<DesktopMediaResponse | null> => {
            const token = await currentAccessToken();
            const headers = new Headers();
            if (token !== null) headers.set("authorization", `Bearer ${token}`);
            headers.set("x-recall-media-reference", JSON.stringify(reference));
            if (mediaRequest.expectedOwnerId)
              headers.set("x-recall-workspace-owner", mediaRequest.expectedOwnerId);
            if (mediaRequest.method === "POST") {
              headers.set("content-type", "application/octet-stream");
            }
            const response = await fetch(targetUrl.right, {
              method: mediaRequest.method,
              signal: AbortSignal.timeout(apiRequestTimeoutMs),
              headers,
              ...(mediaRequest.method === "POST" && mediaRequest.bytes !== null
                ? { body: Buffer.from(mediaRequest.bytes) }
                : {}),
            });
            const reader = response.body?.getReader();
            if (!reader) return { status: response.status, bytes: new Uint8Array() };
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              totalBytes += part.value.byteLength;
              if (totalBytes > maxPublishedMediaBytes) {
                void reader.cancel().catch(() => undefined);
                return null;
              }
              chunks.push(part.value);
            }
            const responseBytes = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
              responseBytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            if (mediaRequest.method === "GET" && response.ok) {
              if (
                responseBytes.byteLength !== reference.byteLength ||
                !verifyMediaAsset({ reference, bytes: responseBytes })
              ) {
                return null;
              }
            }
            return { status: response.status, bytes: responseBytes };
          },
          catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
        }),
      ),
    );
    return Either.isLeft(result) || result.right === null
      ? failure()
      : { _tag: "Success", value: result.right };
  };
}
