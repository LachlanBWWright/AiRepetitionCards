import { Effect } from "effect";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

const issuer = "https://auth.openai.com";
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
const algorithms = [
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

export type OpenAiSignInProviderError = {
  readonly _tag: "OpenAiSignInProviderError";
  readonly reason:
    | "configuration"
    | "discovery"
    | "network"
    | "token-exchange"
    | "identity-token"
    | "identity-claims";
};
export type OpenAiSignInConfiguration = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly tokenEndpointAuthentication: "none" | "client_secret_basic";
  readonly clientSecret?: string;
  readonly fetch?: typeof fetch;
};
export type OpenAiSignInTransaction = {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
};
export type OpenAiVerifiedIdentity = {
  readonly provider: "openai";
  readonly issuer: string;
  readonly clientId: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly picture: string | null;
};
export type OpenAiSignInProvider = {
  readonly authorizationUrl: (
    transaction: OpenAiSignInTransaction,
  ) => Effect.Effect<string, OpenAiSignInProviderError>;
  readonly exchangeIdentity: (input: {
    readonly code: string;
    readonly transaction: OpenAiSignInTransaction;
  }) => Effect.Effect<OpenAiVerifiedIdentity, OpenAiSignInProviderError>;
};
type Discovery = {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
};
function failure(reason: OpenAiSignInProviderError["reason"]): OpenAiSignInProviderError {
  return { _tag: "OpenAiSignInProviderError", reason };
}
function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
function approvedEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Effect.runSync(Effect.either(Effect.try(() => new URL(value))));
  return (
    parsed._tag === "Right" &&
    parsed.right.origin === issuer &&
    !parsed.right.username &&
    !parsed.right.password &&
    !parsed.right.hash
  );
}
function configurationValid(configuration: OpenAiSignInConfiguration): boolean {
  const parsed = Effect.runSync(
    Effect.either(Effect.try(() => new URL(configuration.redirectUri))),
  );
  if (parsed._tag === "Left") return false;
  const callback = parsed.right;
  return (
    configuration.clientId.length > 0 &&
    configuration.clientId.length <= 200 &&
    !callback.username &&
    !callback.password &&
    !callback.hash &&
    (callback.protocol === "https:" ||
      (callback.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname))) &&
    (configuration.tokenEndpointAuthentication === "none"
      ? !configuration.clientSecret
      : typeof configuration.clientSecret === "string" &&
        configuration.clientSecret.length > 0 &&
        configuration.clientSecret.length <= 5000)
  );
}
/** Reads a bounded response without propagating provider bodies or credentials in errors. */
function requestJson(
  configuration: OpenAiSignInConfiguration,
  url: string,
  init: RequestInit,
  limit: number,
  reason: OpenAiSignInProviderError["reason"],
): Effect.Effect<unknown, OpenAiSignInProviderError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await (configuration.fetch ?? fetch)(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.body) return null;
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > limit) {
        await response.body.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0;
      let text = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return text + decoder.decode();
          size += chunk.value.byteLength;
          if (size > limit) {
            await reader.cancel();
            return null;
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
    },
    catch: () => failure("network"),
  }).pipe(
    Effect.flatMap((text) =>
      text === null
        ? Effect.fail(failure(reason))
        : Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => failure(reason) }),
    ),
  );
}
function optionalClaim(value: unknown, limit: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= limit);
}

/** Identity-only OIDC: access/refresh tokens are neither required nor retained. */
export function createOpenAiSignInProvider(
  configuration: OpenAiSignInConfiguration,
): OpenAiSignInProvider {
  let discoveryCache: { readonly value: Discovery; readonly expiresAt: number } | undefined;
  let keysCache:
    | {
        readonly value: ReturnType<typeof createLocalJWKSet>;
        readonly expiresAt: number;
        readonly uri: string;
        readonly fetchedAt: number;
      }
    | undefined;
  function discover(): Effect.Effect<Discovery, OpenAiSignInProviderError> {
    return Effect.suspend(() => {
      if (!configurationValid(configuration)) return Effect.fail(failure("configuration"));
      if (discoveryCache && discoveryCache.expiresAt > Date.now())
        return Effect.succeed(discoveryCache.value);
      return requestJson(
        configuration,
        discoveryUrl,
        { headers: { accept: "application/json" } },
        64_000,
        "discovery",
      ).pipe(
        Effect.flatMap((body) => {
          const data = record(body);
          if (
            data?.issuer !== issuer ||
            !approvedEndpoint(data.authorization_endpoint) ||
            !approvedEndpoint(data.token_endpoint) ||
            !approvedEndpoint(data.jwks_uri)
          )
            return Effect.fail(failure("discovery"));
          const methods = data.token_endpoint_auth_methods_supported;
          if (
            methods !== undefined &&
            (!Array.isArray(methods) ||
              !methods.includes(configuration.tokenEndpointAuthentication))
          )
            return Effect.fail(failure("configuration"));
          const value: Discovery = {
            authorizationEndpoint: data.authorization_endpoint,
            tokenEndpoint: data.token_endpoint,
            jwksUri: data.jwks_uri,
          };
          discoveryCache = { value, expiresAt: Date.now() + 300_000 };
          return Effect.succeed(value);
        }),
      );
    });
  }
  function keys(
    uri: string,
    refresh = false,
  ): Effect.Effect<ReturnType<typeof createLocalJWKSet>, OpenAiSignInProviderError> {
    return Effect.suspend(() => {
      if (
        keysCache?.uri === uri &&
        keysCache.expiresAt > Date.now() &&
        (!refresh || keysCache.fetchedAt + 30_000 > Date.now())
      )
        return Effect.succeed(keysCache.value);
      return requestJson(
        configuration,
        uri,
        { headers: { accept: "application/json" } },
        256_000,
        "identity-token",
      ).pipe(
        Effect.flatMap((body) => {
          const data = record(body);
          if (
            !Array.isArray(data?.keys) ||
            data.keys.length === 0 ||
            data.keys.length > 100 ||
            !data.keys.every((key: unknown) => typeof record(key)?.kty === "string")
          )
            return Effect.fail(failure("identity-token"));
          return Effect.try({
            try: () => createLocalJWKSet({ keys: data.keys } as JSONWebKeySet),
            catch: () => failure("identity-token"),
          }).pipe(
            Effect.map((value) => {
              const fetchedAt = Date.now();
              keysCache = { uri, value, fetchedAt, expiresAt: fetchedAt + 300_000 };
              return value;
            }),
          );
        }),
      );
    });
  }
  function verify(token: string, keySet: ReturnType<typeof createLocalJWKSet>) {
    return Effect.tryPromise({
      try: () =>
        jwtVerify(token, keySet, {
          issuer,
          audience: configuration.clientId,
          algorithms,
          requiredClaims: ["sub", "exp", "iat", "nonce"],
          clockTolerance: 5,
        }),
      catch: (error: unknown) => ({
        ...failure("identity-token"),
        refresh: record(error)?.code === "ERR_JWKS_NO_MATCHING_KEY",
      }),
    });
  }
  return {
    authorizationUrl: (transaction) =>
      discover().pipe(
        Effect.flatMap((discovery) => {
          if (
            transaction.redirectUri !== configuration.redirectUri ||
            !transaction.state ||
            !transaction.nonce ||
            !/^[A-Za-z0-9_-]{43}$/.test(transaction.codeChallenge)
          )
            return Effect.fail(failure("configuration"));
          const url = new URL(discovery.authorizationEndpoint);
          url.search = new URLSearchParams({
            client_id: configuration.clientId,
            redirect_uri: transaction.redirectUri,
            response_type: "code",
            scope: "openid profile email",
            state: transaction.state,
            code_challenge: transaction.codeChallenge,
            code_challenge_method: "S256",
            nonce: transaction.nonce,
          }).toString();
          return Effect.succeed(url.toString());
        }),
      ),
    exchangeIdentity: ({ code, transaction }) =>
      Effect.gen(function* () {
        const discovery = yield* discover();
        if (
          !code ||
          code.length > 8192 ||
          transaction.redirectUri !== configuration.redirectUri ||
          !transaction.nonce ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(transaction.codeVerifier)
        )
          return yield* Effect.fail(failure("configuration"));
        const headers: Record<string, string> = {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        };
        if (configuration.tokenEndpointAuthentication === "client_secret_basic") {
          const encode = (value: string) =>
            new URLSearchParams({ value }).toString().slice("value=".length);
          headers.authorization = `Basic ${btoa(`${encode(configuration.clientId)}:${encode(configuration.clientSecret ?? "")}`)}`;
        }
        const response = yield* requestJson(
          configuration,
          discovery.tokenEndpoint,
          {
            method: "POST",
            headers,
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: transaction.redirectUri,
              client_id: configuration.clientId,
              code_verifier: transaction.codeVerifier,
            }),
          },
          64_000,
          "token-exchange",
        );
        const token = record(response)?.id_token;
        if (typeof token !== "string" || !token || token.length > 32_000)
          return yield* Effect.fail(failure("token-exchange"));
        const keySet = yield* keys(discovery.jwksUri);
        const verified = yield* verify(token, keySet).pipe(
          Effect.catchAll((error) =>
            error.refresh
              ? keys(discovery.jwksUri, true).pipe(Effect.flatMap((fresh) => verify(token, fresh)))
              : Effect.fail(error),
          ),
        );
        const payload = verified.payload;
        const now = Date.now() / 1000;
        if (
          payload.nonce !== transaction.nonce ||
          typeof payload.sub !== "string" ||
          !payload.sub ||
          payload.sub.length > 512 ||
          typeof payload.iat !== "number" ||
          !Number.isSafeInteger(payload.iat) ||
          payload.iat > now + 5 ||
          typeof payload.exp !== "number" ||
          !Number.isSafeInteger(payload.exp) ||
          payload.exp <= payload.iat ||
          !optionalClaim(payload.email, 320) ||
          !optionalClaim(payload.name, 500) ||
          !optionalClaim(payload.picture, 2048) ||
          (payload.email_verified !== undefined && typeof payload.email_verified !== "boolean")
        )
          return yield* Effect.fail(failure("identity-claims"));
        return {
          provider: "openai" as const,
          issuer,
          clientId: configuration.clientId,
          subject: payload.sub,
          email: typeof payload.email === "string" ? payload.email : null,
          emailVerified: payload.email_verified === true,
          name: typeof payload.name === "string" ? payload.name : null,
          picture: typeof payload.picture === "string" ? payload.picture : null,
        };
      }),
  };
}
