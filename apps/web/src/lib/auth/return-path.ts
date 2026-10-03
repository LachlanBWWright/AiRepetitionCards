import { Either, Schema } from "effect";
import { PublicationVersionIdSchema, PublishedShareTokenSchema } from "@recall/contracts";

/** Only shared publication previews may be used as post-auth return destinations. */
export function sharedPublicationReturnPath(input: unknown): string {
  if (typeof input !== "string") return "/";
  const match = /^\/shared\/([^/?#]+)(?:\?token=([^&#]+))?$/.exec(input);
  if (!match?.[1]) return "/";
  const versionId = Schema.decodeUnknownEither(PublicationVersionIdSchema)(match[1]);
  if (Either.isLeft(versionId)) return "/";
  if (match[2] === undefined) return `/shared/${versionId.right}`;
  const token = Schema.decodeUnknownEither(PublishedShareTokenSchema)(match[2]);
  if (Either.isLeft(token)) return "/";
  return `/shared/${versionId.right}?token=${encodeURIComponent(token.right)}`;
}

export function sharedReturnPathFromQuery(values: readonly string[]): string {
  return values.length === 1 ? sharedPublicationReturnPath(values[0]) : "/";
}
