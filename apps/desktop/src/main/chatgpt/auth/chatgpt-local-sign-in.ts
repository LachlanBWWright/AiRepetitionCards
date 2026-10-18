import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { shell } from "electron";
import { Effect, Either } from "effect";
import { jwtVerify } from "jose";
import {
  fail,
  identityAlgorithms,
  IdInput,
  issuer,
  jwks,
  resource,
  sameSecret,
  Token,
} from "../transport/chatgpt-local-protocol";
import type { LocalAccount, LocalStore, Reply } from "../transport/chatgpt-local-protocol";

type SignInDependencies = {
  readonly load: () => Promise<Reply<LocalStore>>;
  readonly serialize: <T>(operation: () => Promise<Reply<T>>) => Promise<Reply<T>>;
  readonly save: (store: LocalStore) => Promise<void>;
  readonly getStore: () => LocalStore | null;
  readonly update: (account: LocalAccount, activate?: boolean) => Promise<void>;
  readonly tokenRequest: (parameters: Record<string, string>) => Promise<Reply<typeof Token.Type>>;
  readonly advanceInferenceGeneration: () => void;
  readonly cancelInference: () => void;
};

export async function performChatGptLocalSignIn(
  input: typeof IdInput.Type,
  dependencies: SignInDependencies,
): Promise<Reply<boolean>> {
  const {
    load,
    serialize,
    save,
    getStore,
    update,
    tokenRequest,
    advanceInferenceGeneration,
    cancelInference,
  } = dependencies;
  const loaded = await serialize(load);
  if (loaded._tag === "Failure") return loaded;
  const selected =
    input.clientId === null
      ? loaded.value.accounts[0]
      : loaded.value.accounts.find((item) => item.clientId === input.clientId);
  if (input.clientId !== null && !selected) return fail("unknown-account");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  let resolveCallback: (value: URL | null) => void = () => undefined;
  const callback = new Promise<URL | null>((resolve) => {
    resolveCallback = resolve;
  });
  const server = createServer((request, response) => {
    const parsed = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => new URL(request.url ?? "", "http://127.0.0.1"),
          catch: () => fail("invalid-callback"),
        }),
      ),
    );
    if (
      Either.isLeft(parsed) ||
      request.method !== "GET" ||
      parsed.right.pathname !== "/auth/callback" ||
      parsed.right.searchParams.getAll("state").length !== 1 ||
      !sameSecret(parsed.right.searchParams.get("state") ?? "", state)
    ) {
      response.writeHead(400);
      response.end("Invalid sign-in callback.");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/plain",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
    });
    response.end("Return to Recall to finish signing in.");
    resolveCallback(parsed.right);
  });
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => {
      resolve(false);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(true);
    });
  });
  if (!listening) return fail("callback-listener-unavailable");
  const timer = setTimeout(() => {
    resolveCallback(null);
  }, 180_000);
  try {
    const address = server.address();
    if (!address || typeof address === "string") return fail("callback-listener-unavailable");
    const redirectUri = `http://127.0.0.1:${String(address.port)}/auth/callback`;
    const authorizationClientId =
      selected?.clientId ?? loaded.value.pendingClientId ?? "dynamic_agent_client";
    const parameters = new URLSearchParams({
      client_id: authorizationClientId,
      ext_agent_host_id: loaded.value.hostId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    if (authorizationClientId === "dynamic_agent_client")
      parameters.set("agent_name_hint", "Recall");
    if (selected?.credentials) parameters.set("id_token_hint", selected.credentials.idToken);
    if (selected?.email) parameters.set("login_hint", selected.email);
    if (input.enablePlan) parameters.set("prompt", "consent");
    await shell.openExternal(`${issuer}/api/accounts/authorize?${parameters}`);
    const result = await callback;
    if (!result) return fail("sign-in-timeout");
    const errors = result.searchParams.getAll("error");
    if (errors.length > 1 || (errors.length === 1 && result.searchParams.has("code")))
      return fail("invalid-callback");
    const oauthError = errors[0];
    if (oauthError)
      return fail(oauthError === "access_denied" ? "access-denied" : "authorization-failed");
    const code = result.searchParams.get("code");
    const returnedClient = result.searchParams.get("client_id");
    const clientId =
      authorizationClientId === "dynamic_agent_client" ? returnedClient : authorizationClientId;
    if (
      !code ||
      code.length > 4096 ||
      !clientId ||
      clientId.length > 200 ||
      clientId === "dynamic_agent_client" ||
      result.searchParams.getAll("code").length !== 1 ||
      result.searchParams.getAll("client_id").length > 1 ||
      (authorizationClientId !== "dynamic_agent_client" &&
        returnedClient &&
        returnedClient !== authorizationClientId)
    )
      return fail("invalid-registration");
    if (!selected) {
      const saved = await serialize(async () => {
        const store = getStore();
        if (!store) return fail("credential-storage-failed");
        await save({ ...store, pendingClientId: clientId });
        return { _tag: "Success", value: true };
      });
      if (saved._tag === "Failure") return saved;
    }
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    });
    if (tokens._tag === "Failure") return tokens;
    if (!tokens.value.id_token) return fail("incomplete-token-response");
    const identity = await jwtVerify(tokens.value.id_token, jwks, {
      issuer,
      audience: clientId,
      algorithms: identityAlgorithms,
      requiredClaims: ["sub", "exp", "iat", "nonce"],
      clockTolerance: 5,
    });
    const store = getStore();
    const registeredIdentity =
      selected ?? store?.accounts.find((account) => account.clientId === clientId);
    if (
      identity.payload.nonce !== nonce ||
      !identity.payload.sub ||
      typeof identity.payload.iat !== "number" ||
      !Number.isSafeInteger(identity.payload.iat) ||
      identity.payload.iat > Date.now() / 1000 + 5 ||
      (registeredIdentity && registeredIdentity.subject !== identity.payload.sub)
    )
      return fail("identity-mismatch");
    const account: LocalAccount = {
      clientId,
      label: "ChatGPT account",
      subject: identity.payload.sub,
      email: typeof identity.payload.email === "string" ? identity.payload.email : null,
      credentials: {
        accessToken: tokens.value.access_token,
        refreshToken: tokens.value.refresh_token ?? null,
        idToken: tokens.value.id_token,
        expiresAt: Date.now() + tokens.value.expires_in * 1000,
        scopes: (tokens.value.scope ?? "").split(/\s+/).filter(Boolean),
      },
    };
    advanceInferenceGeneration();
    cancelInference();
    return await serialize(async () => {
      await update(account, true);
      const currentStore = getStore();
      if (currentStore) await save({ ...currentStore, pendingClientId: null });
      return { _tag: "Success", value: true };
    });
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}
