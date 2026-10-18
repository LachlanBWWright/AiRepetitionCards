import { Effect, Either, Schema } from "effect";
import { createChatGPTAuthSignIn } from "./chatgpt-auth-sign-in";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32000));
export const client = Schema.String.pipe(
  Schema.pattern(/^(?!dynamic_agent_client$)[A-Za-z0-9_-]{1,200}$/),
);
const Credentials = Schema.Struct({
  accessToken: text,
  refreshToken: Schema.NullOr(text),
  idToken: text,
  expiresAt: Schema.Number.pipe(Schema.finite(), Schema.positive()),
  scopes: Schema.Array(Schema.String.pipe(Schema.maxLength(200))).pipe(Schema.maxItems(30)),
});
const Account = Schema.Struct({
  clientId: client,
  subject: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  email: Schema.NullOr(Schema.String.pipe(Schema.maxLength(320))),
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  credentials: Schema.NullOr(Credentials),
});
const Store = Schema.Struct({
  version: Schema.Literal(1),
  hostId: Schema.String.pipe(
    Schema.pattern(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  ),
  activeClientId: Schema.NullOr(client),
  pendingClientId: Schema.NullOr(client),
  accounts: Schema.Array(Account).pipe(Schema.maxItems(10)),
});
export type Store = typeof Store.Type;
export type Account = typeof Account.Type;
const Tokens = Schema.Struct({
  access_token: text,
  token_type: Schema.String.pipe(Schema.pattern(/^Bearer$/i)),
  refresh_token: Schema.optional(text),
  id_token: Schema.optional(text),
  expires_in: Schema.Int.pipe(Schema.between(1, 31536000)),
  scope: Schema.optional(Schema.String.pipe(Schema.maxLength(6000))),
});
const Claims = Schema.Struct({
  iss: Schema.Literal(issuer),
  aud: Schema.Union(Schema.String, Schema.Array(Schema.String)),
  azp: Schema.optional(Schema.String),
  sub: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  iat: Schema.Int,
  exp: Schema.Int,
  nbf: Schema.optional(Schema.Int),
  nonce: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String.pipe(Schema.maxLength(320))),
});
export type ChatGPTAuthFailure = {
  readonly _tag: "ChatGPTAuthFailure";
  readonly code: string;
};
export const fail = (code: string): ChatGPTAuthFailure => ({ _tag: "ChatGPTAuthFailure", code });
export type ChatGPTAuthStatus = {
  readonly activeClientId: string | null;
  readonly accounts: readonly {
    readonly clientId: string;
    readonly label: string;
    readonly email: string | null;
    readonly signedIn: boolean;
    readonly planEnabled: boolean;
  }[];
};
/** Infrastructure ports are deliberately independent of Recall/Supabase authentication. */
export type ChatGPTAuthPorts = {
  readonly read: () => Effect.Effect<string | null, ChatGPTAuthFailure>;
  readonly write: (value: string) => Effect.Effect<void, ChatGPTAuthFailure>;
  readonly random: () => Effect.Effect<string, ChatGPTAuthFailure>;
  readonly hostId: () => string;
  readonly challenge: (verifier: string) => Effect.Effect<string, ChatGPTAuthFailure>;
  readonly now: () => number;
  readonly start: (
    state: string,
  ) => Effect.Effect<{ readonly id: string; readonly redirectUri: string }, ChatGPTAuthFailure>;
  readonly callback: (id: string) => Effect.Effect<string, ChatGPTAuthFailure>;
  readonly stop: (id: string) => Effect.Effect<void, ChatGPTAuthFailure>;
  readonly open: (url: string) => Effect.Effect<void, ChatGPTAuthFailure>;
  readonly request: (
    url: string,
    form: Readonly<Record<string, string>> | null,
  ) => Effect.Effect<{ readonly status: number; readonly body: unknown }, ChatGPTAuthFailure>;
  readonly verifySignature: (
    token: string,
    jwks: unknown,
  ) => Effect.Effect<boolean, ChatGPTAuthFailure>;
};
export const decode = <A>(schema: Schema.Schema<A>, value: unknown, code: string) =>
  Schema.decodeUnknown(schema)(value).pipe(Effect.mapError(() => fail(code)));
function json(value: string) {
  return Effect.try({
    try: (): unknown => JSON.parse(value),
    catch: () => fail("invalid-stored-session"),
  });
}
function payload(token: string) {
  return Effect.try({
    try: (): unknown => {
      const part = token.split(".")[1] ?? "";
      const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
      return JSON.parse(
        decodeURIComponent(
          Array.from(bytes, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
        ),
      ) as unknown;
    },
    catch: () => fail("invalid-identity-token"),
  });
}
export function createChatGPTAuth(ports: ChatGPTAuthPorts) {
  const lane = Effect.runSync(Effect.makeSemaphore(1));
  const listeners = new Set<() => void>();
  let generation = 0;
  let pending: string | null = null;
  let signingIn = false;
  const changed = () => {
    generation += 1;
    listeners.forEach((listener) => {
      listener();
    });
  };
  const load = () =>
    Effect.gen(function* () {
      const saved = yield* ports.read();
      if (saved === null) {
        const hostId = yield* Effect.try({
          try: ports.hostId,
          catch: () => fail("secure-random-unavailable"),
        });
        const store: Store = {
          version: 1,
          hostId: `urn:uuid:${hostId}`,
          activeClientId: null,
          pendingClientId: null,
          accounts: [],
        };
        yield* decode(Store, store, "invalid-host-id");
        yield* ports.write(JSON.stringify(store));
        return store;
      }
      if (saved.length > 1000000) return yield* Effect.fail(fail("invalid-stored-session"));
      const store = yield* json(saved).pipe(
        Effect.flatMap((value) => decode(Store, value, "invalid-stored-session")),
      );
      if (
        new Set(store.accounts.map((a) => a.clientId)).size !== store.accounts.length ||
        (store.activeClientId !== null &&
          !store.accounts.some((a) => a.clientId === store.activeClientId))
      )
        return yield* Effect.fail(fail("invalid-stored-session"));
      const account =
        store.accounts.find((item) => item.clientId === store.activeClientId) ?? store.accounts[0];
      const single: Store = {
        ...store,
        activeClientId: account?.credentials ? account.clientId : null,
        accounts: account ? [{ ...account, label: "ChatGPT account" }] : [],
      };
      if (JSON.stringify(single) !== JSON.stringify(store))
        yield* ports.write(JSON.stringify(single));
      return single;
    });
  const save = (store: Store) => ports.write(JSON.stringify(store));
  const update = (store: Store, account: Account) =>
    save({
      ...store,
      accounts: [account],
    });
  const request = (path: string, form: Readonly<Record<string, string>> | null) =>
    Effect.gen(function* () {
      const response = yield* ports.request(`${issuer}${path}`, form);
      if (response.status < 200 || response.status >= 300) {
        const error = Schema.decodeUnknownEither(
          Schema.Struct({
            error: Schema.Union(Schema.String, Schema.Struct({ code: Schema.String })),
          }),
        )(response.body);
        // Only classified codes cross the vendor boundary, never provider messages or bodies.
        const code = Either.isRight(error)
          ? typeof error.right.error === "string"
            ? error.right.error
            : error.right.error.code
          : "";
        const terminal = [
          "invalid_grant",
          "invalid_refresh_token",
          "refresh_token_expired",
          "refresh_token_reused",
          "refresh_token_invalidated",
          "invalid_token",
        ].includes(code);
        return yield* Effect.fail(
          fail(
            terminal
              ? "session-expired"
              : response.status === 429
                ? "rate-limited"
                : "provider-unavailable",
          ),
        );
      }
      return response.body;
    });
  const verify = (token: string, clientId: string, nonce?: string) =>
    Effect.gen(function* () {
      const keys = yield* request("/.well-known/jwks.json", null);
      if (!(yield* ports.verifySignature(token, keys)))
        return yield* Effect.fail(fail("invalid-identity-token"));
      const claims = yield* payload(token).pipe(
        Effect.flatMap((value) => decode(Claims, value, "invalid-identity-token")),
      );
      const now = Math.floor(ports.now() / 1000);
      const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
      if (
        !audience.includes(clientId) ||
        (audience.length > 1 && claims.azp !== clientId) ||
        (claims.azp !== undefined && claims.azp !== clientId) ||
        claims.exp <= now - 5 ||
        claims.exp <= claims.iat ||
        claims.iat > now + 5 ||
        (claims.nbf !== undefined && claims.nbf > now + 5) ||
        (nonce !== undefined && claims.nonce !== nonce)
      )
        return yield* Effect.fail(fail("identity-mismatch"));
      return claims;
    });
  const status = lane.withPermits(1)(
    Effect.gen(function* () {
      const store = yield* load();
      const result: ChatGPTAuthStatus = {
        activeClientId: store.activeClientId,
        accounts: store.accounts.map((a) => ({
          clientId: a.clientId,
          label: a.label,
          email: a.email,
          signedIn: a.credentials !== null,
          planEnabled: a.credentials?.scopes.includes("chatgpt.tokens.use.direct") ?? false,
        })),
      };
      return result;
    }),
  );
  const signIn = createChatGPTAuthSignIn({
    ports,
    lane,
    load,
    save,
    update,
    request,
    verify,
    changed,
    generation: () => generation,
    setPending: (value) => {
      pending = value;
    },
    setSigningIn: (value) => {
      signingIn = value;
    },
    isSigningIn: () => signingIn,
  });
  const cancel = () =>
    Effect.suspend(() => {
      generation += 1;
      return pending ? ports.stop(pending) : Effect.void;
    });
  const accessToken = (clientId: string) =>
    lane.withPermits(1)(
      Effect.gen(function* () {
        const store = yield* load();
        const account = store.accounts.find((a) => a.clientId === clientId);
        if (store.activeClientId !== clientId || !account?.credentials)
          return yield* Effect.fail(fail("account-changed"));
        const credentials = account.credentials;
        if (!credentials.scopes.includes("chatgpt.tokens.use.direct"))
          return yield* Effect.fail(fail("plan-permission-required"));
        if (credentials.expiresAt > ports.now() + 60000) return credentials.accessToken;
        if (!credentials.refreshToken) return yield* Effect.fail(fail("sign-in-required"));
        const refreshed = yield* Effect.either(
          request("/api/accounts/oauth/token", {
            grant_type: "refresh_token",
            client_id: clientId,
            refresh_token: credentials.refreshToken,
            resource,
          }),
        );
        if (Either.isLeft(refreshed)) {
          if (refreshed.left.code === "session-expired") {
            yield* update(store, { ...account, credentials: null });
            changed();
          }
          return yield* Effect.fail(refreshed.left);
        }
        const tokens = yield* decode(Tokens, refreshed.right, "incomplete-token-response");
        if (!tokens.refresh_token) return yield* Effect.fail(fail("incomplete-token-response"));
        if (tokens.id_token) {
          const identity = yield* verify(tokens.id_token, clientId);
          if (identity.sub !== account.subject)
            return yield* Effect.fail(fail("identity-mismatch"));
        }
        const next = {
          ...credentials,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token ?? credentials.idToken,
          expiresAt: ports.now() + tokens.expires_in * 1000,
          scopes:
            tokens.scope === undefined
              ? credentials.scopes
              : tokens.scope.split(/\s+/).filter(Boolean),
        };
        yield* update(store, { ...account, credentials: next });
        if (!next.scopes.includes("chatgpt.tokens.use.direct")) {
          changed();
          return yield* Effect.fail(fail("plan-permission-required"));
        }
        return next.accessToken;
      }),
    );
  const signOut = (clientId: string) =>
    lane.withPermits(1)(
      Effect.gen(function* () {
        if (signingIn) return yield* Effect.fail(fail("sign-in-in-progress"));
        const store = yield* load();
        const account = store.accounts.find((a) => a.clientId === clientId);
        if (!account) return yield* Effect.fail(fail("unknown-account"));
        // Clear locally before attempting remote revocation. Failure must never restore tokens.
        yield* save({ ...store, activeClientId: null, pendingClientId: null, accounts: [] });
        changed();
        if (!account.credentials?.refreshToken) return { remoteRevocationConfirmed: false };
        const revoked = yield* Effect.either(
          ports.request(`${issuer}/api/accounts/oauth/revoke`, {
            client_id: clientId,
            token: account.credentials.refreshToken,
            token_type_hint: "refresh_token",
          }),
        );
        return {
          remoteRevocationConfirmed:
            Either.isRight(revoked) && revoked.right.status >= 200 && revoked.right.status < 300,
        };
      }),
    );
  return {
    status,
    epoch: () => generation,
    signIn,
    cancel,
    signOut,
    accessToken,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
