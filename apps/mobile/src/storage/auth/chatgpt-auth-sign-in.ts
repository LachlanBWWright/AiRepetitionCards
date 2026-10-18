import { Effect, Schema } from "effect";
import type { ChatGPTAuthFailure, ChatGPTAuthPorts } from "./chatgpt-auth";
import { client, fail } from "./chatgpt-auth";
import type { Account, Store } from "./chatgpt-auth";

export type ChatGPTAuthSignInDependencies = {
  readonly ports: ChatGPTAuthPorts;
  readonly lane: {
    withPermits: (
      permits: number,
    ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  };
  readonly load: () => Effect.Effect<Store, ChatGPTAuthFailure>;
  readonly save: (store: Store) => Effect.Effect<void, ChatGPTAuthFailure>;
  readonly update: (store: Store, account: Account) => Effect.Effect<void, ChatGPTAuthFailure>;
  readonly request: (
    path: string,
    form: Readonly<Record<string, string>> | null,
  ) => Effect.Effect<unknown, ChatGPTAuthFailure>;
  readonly verify: (
    token: string,
    clientId: string,
    nonce?: string,
  ) => Effect.Effect<
    { readonly sub: string; readonly email?: string | undefined },
    ChatGPTAuthFailure
  >;
  readonly changed: () => void;
  readonly generation: () => number;
  readonly setPending: (id: string | null) => void;
  readonly setSigningIn: (value: boolean) => void;
  readonly isSigningIn: () => boolean;
};
const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const Tokens = Schema.Struct({
  access_token: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32000)),
  token_type: Schema.String.pipe(Schema.pattern(/^Bearer$/i)),
  refresh_token: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32000))),
  id_token: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32000))),
  expires_in: Schema.Int.pipe(Schema.between(1, 31536000)),
  scope: Schema.optional(Schema.String.pipe(Schema.maxLength(6000))),
});
const decodeTokens = (value: unknown) =>
  Schema.decodeUnknown(Tokens)(value).pipe(
    Effect.mapError(() => fail("incomplete-token-response")),
  );
export function createChatGPTAuthSignIn(deps: ChatGPTAuthSignInDependencies) {
  const {
    ports,
    lane,
    load,
    save,
    update,
    request,
    verify,
    changed,
    generation,
    setPending,
    setSigningIn,
    isSigningIn,
  } = deps;
  const decode = <A>(schema: Schema.Schema<A>, value: unknown, code: string) =>
    Schema.decodeUnknown(schema)(value).pipe(Effect.mapError(() => fail(code)));
  const clientSchema = client;
  const issueRegistration = (store: Store, clientId: string) =>
    save({ ...store, pendingClientId: clientId });
  function persistIdentity(
    issuedClient: string,
    idToken: string,
    tokens: typeof Tokens.Type,
    identity: { readonly sub: string; readonly email?: string | undefined },
    expectedGeneration: number,
  ) {
    return lane.withPermits(1)(
      Effect.gen(function* () {
        const latest = yield* load();
        const registered = latest.accounts.find((a) => a.clientId === issuedClient);
        if (
          generation() !== expectedGeneration ||
          (registered && registered.subject !== identity.sub)
        )
          return yield* Effect.fail(fail("identity-mismatch"));
        const account: Account = {
          clientId: issuedClient,
          subject: identity.sub,
          email: identity.email ?? null,
          label: "ChatGPT account",
          credentials: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            idToken,
            expiresAt: ports.now() + tokens.expires_in * 1000,
            scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
          },
        };
        yield* update({ ...latest, activeClientId: issuedClient, pendingClientId: null }, account);
        changed();
      }),
    );
  }
  return (clientId: string | null = null, enablePlan = false) =>
    Effect.suspend(() => {
      if (isSigningIn()) return Effect.fail(fail("sign-in-in-progress"));
      setSigningIn(true);
      const expectedGeneration = generation();
      return Effect.gen(function* () {
        const store = yield* lane.withPermits(1)(load());
        const selected =
          clientId === null
            ? store.accounts[0]
            : store.accounts.find((a) => a.clientId === clientId);
        if (clientId !== null && !selected) return yield* Effect.fail(fail("unknown-account"));
        const state = yield* ports.random();
        const nonce = yield* ports.random();
        const verifier = yield* ports.random();
        const challenge = yield* ports.challenge(verifier);
        const listener = yield* ports.start(state);
        setPending(listener.id);
        return yield* Effect.gen(function* () {
          if (generation() !== expectedGeneration) return yield* Effect.fail(fail("cancelled"));
          const redirect = yield* Effect.try({
            try: () => new URL(listener.redirectUri),
            catch: () => fail("invalid-callback"),
          });
          if (
            redirect.protocol !== "http:" ||
            redirect.hostname !== "127.0.0.1" ||
            redirect.pathname !== "/auth/callback" ||
            !redirect.port ||
            redirect.search ||
            redirect.hash ||
            redirect.username ||
            redirect.password
          )
            return yield* Effect.fail(fail("invalid-callback"));
          const authorizationClient =
            selected?.clientId ?? store.pendingClientId ?? "dynamic_agent_client";
          const parameters = new URLSearchParams({
            client_id: authorizationClient,
            ext_agent_host_id: store.hostId,
            response_type: "code",
            redirect_uri: listener.redirectUri,
            scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            resource,
            state,
            nonce,
            code_challenge_method: "S256",
            code_challenge: challenge,
          });
          if (authorizationClient === "dynamic_agent_client")
            parameters.set("agent_name_hint", "Recall");
          if (selected?.credentials) parameters.set("id_token_hint", selected.credentials.idToken);
          if (selected?.email) parameters.set("login_hint", selected.email);
          if (enablePlan) parameters.set("prompt", "consent");
          yield* ports.open(`${issuer}/api/accounts/authorize?${parameters}`);
          const callback = yield* ports.callback(listener.id);
          const url = yield* Effect.try({
            try: () => new URL(callback),
            catch: () => fail("invalid-callback"),
          });
          if (
            url.origin !== redirect.origin ||
            url.pathname !== redirect.pathname ||
            url.hash ||
            url.username ||
            url.password ||
            ["state", "code", "client_id", "error"].some(
              (key) => url.searchParams.getAll(key).length > 1,
            ) ||
            url.searchParams.get("state") !== state
          )
            return yield* Effect.fail(fail("invalid-callback"));
          if (url.searchParams.has("error") && url.searchParams.has("code"))
            return yield* Effect.fail(fail("invalid-callback"));
          const authorizationError = url.searchParams.get("error");
          if (authorizationError !== null)
            return yield* Effect.fail(
              fail(authorizationError === "access_denied" ? "cancelled" : "authorization-failed"),
            );
          const code = url.searchParams.get("code");
          const returnedClient = url.searchParams.get("client_id");
          const issuedClient =
            authorizationClient === "dynamic_agent_client" ? returnedClient : authorizationClient;
          if (
            !code ||
            code.length > 4096 ||
            !issuedClient ||
            (returnedClient !== null && returnedClient !== issuedClient)
          )
            return yield* Effect.fail(fail("invalid-callback"));
          yield* decode(clientSchema, issuedClient, "invalid-registration");
          if (generation() !== expectedGeneration)
            return yield* Effect.fail(fail("account-changed"));
          // Preserve an issued registration before exchange, even if the exchange fails.
          if (!selected)
            yield* lane.withPermits(1)(
              load().pipe(Effect.flatMap((latest) => issueRegistration(latest, issuedClient))),
            );
          const tokens = yield* request("/api/accounts/oauth/token", {
            grant_type: "authorization_code",
            client_id: issuedClient,
            code,
            code_verifier: verifier,
            redirect_uri: listener.redirectUri,
            resource,
          }).pipe(Effect.flatMap((value) => decodeTokens(value)));
          if (!tokens.id_token) return yield* Effect.fail(fail("incomplete-token-response"));
          const idToken = tokens.id_token;
          const identity = yield* verify(idToken, issuedClient, nonce);
          yield* persistIdentity(issuedClient, idToken, tokens, identity, expectedGeneration);
        }).pipe(Effect.ensuring(ports.stop(listener.id).pipe(Effect.ignore)));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            setPending(null);
            setSigningIn(false);
          }),
        ),
      );
    });
}
