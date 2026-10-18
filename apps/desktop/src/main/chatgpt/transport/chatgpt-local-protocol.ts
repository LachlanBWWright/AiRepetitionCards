import { createRemoteJWKSet } from "jose";
import { timingSafeEqual } from "node:crypto";
import { Effect, Either, Schema } from "effect";

export const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
export const Credentials = Schema.Struct({
  accessToken: text,
  refreshToken: Schema.NullOr(text),
  idToken: text,
  scopes: Schema.Array(text),
  expiresAt: Schema.Number.pipe(
    Schema.finite(),
    Schema.int(),
    Schema.nonNegative(),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
});
export const Account = Schema.Struct({
  clientId: text,
  label: Schema.optional(text),
  subject: text,
  email: Schema.NullOr(text),
  credentials: Schema.NullOr(Credentials),
});
export const Store = Schema.Struct({
  hostId: text,
  pendingClientId: Schema.optional(Schema.NullOr(text)),
  activeClientId: Schema.NullOr(text),
  accounts: Schema.Array(Account),
});
export type LocalStore = typeof Store.Type;
export type LocalAccount = typeof Account.Type;
export type Failure = {
  readonly _tag: "Failure";
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly param?: string | null;
  readonly recovery?:
    | "usage-limit"
    | "unavailable"
    | "ineligible"
    | "unsupported"
    | "permission"
    | "identity"
    | "rate-limit";
};
export type Reply<T> = { readonly _tag: "Success"; readonly value: T } | Failure;
export const fail = (code: string): Failure => ({ _tag: "Failure", code });
export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const identityAlgorithms = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
];
export const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export const Token = Schema.Struct({
  access_token: text,
  refresh_token: Schema.optional(text),
  id_token: Schema.optional(text),
  token_type: text,
  expires_in: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive()),
  scope: Schema.optional(text),
});
export const Models = Schema.Struct({
  models: Schema.Array(Schema.Struct({ slug: text, display_name: text, visibility: text })),
});
export const Request = Schema.Struct({
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  input: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_600_000)),
  expectedClientId: text,
  instructions: Schema.optionalWith(text, { exact: true }),
});
export const ResearchRequest = Schema.Struct({
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  query: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  expectedClientId: text,
});
export const ResearchSourceRequest = Schema.Struct({
  url: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2048)),
  expectedClientId: text,
});
export const IdInput = Schema.Struct({
  clientId: Schema.NullOr(text),
  enablePlan: Schema.optional(Schema.Boolean),
});
export const terminalRefreshErrors = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function responseFailure(value: unknown, response: Response): Failure {
  const body = object(value);
  const error = object(body?.error);
  const candidateCode =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.type === "string"
        ? error.type
        : typeof body?.error === "string"
          ? body.error
          : "request-failed";
  const code = /^[a-z][a-z0-9_.-]{0,127}$/.test(candidateCode) ? candidateCode : "request-failed";
  const recovery = recoveryForFailure(code, response.status);
  return {
    _tag: "Failure",
    code,
    ...(recovery ? { recovery } : {}),
    status: response.status,
    requestId: (() => {
      const value =
        response.headers.get("openai-request-id") ?? response.headers.get("x-request-id");
      return value && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
    })(),
    param:
      typeof error?.param === "string" && /^[A-Za-z0-9_.\[\]-]{1,128}$/.test(error.param)
        ? error.param
        : null,
  };
}
export function inferenceAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function boundedText(response: Response, limit = 2_000_000): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) return result + decoder.decode();
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    result += decoder.decode(part.value, { stream: true });
  }
}
export async function jsonResponse(response: Response): Promise<unknown> {
  const raw = await boundedText(response);
  if (raw === null) return { detail: "response-too-large" };
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({ try: (): unknown => JSON.parse(raw), catch: () => fail("invalid-json") }),
    ),
  );
  return Either.isRight(parsed) ? parsed.right : { detail: raw.slice(0, 2000) };
}

function recoveryForFailure(code: string, status: number): Failure["recovery"] {
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return "usage-limit";
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return "unavailable";
    case "subscription_sharing_user_not_eligible":
      return "ineligible";
    case "subscription_sharing_unsupported_capability":
    case "subscription_sharing_route_not_supported":
      return "unsupported";
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return "permission";
    case "subscription_sharing_invalid_user":
      return "identity";
  }
  if (status === 401) return "identity";
  if (status === 403) return "permission";
  if (status === 429) return "rate-limit";
  return status >= 500 ? "unavailable" : undefined;
}
