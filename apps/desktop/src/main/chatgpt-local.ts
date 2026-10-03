import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { app, ipcMain, safeStorage, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Effect, Either, Schema } from "effect";

const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
const Credentials = Schema.Struct({
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
const Account = Schema.Struct({
  clientId: text,
  label: Schema.optional(text),
  subject: text,
  email: Schema.NullOr(text),
  credentials: Schema.NullOr(Credentials),
});
const Store = Schema.Struct({
  hostId: text,
  pendingClientId: Schema.optional(Schema.NullOr(text)),
  activeClientId: Schema.NullOr(text),
  accounts: Schema.Array(Account),
});
type LocalStore = typeof Store.Type;
type LocalAccount = typeof Account.Type;
type Failure = {
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
type Reply<T> = { readonly _tag: "Success"; readonly value: T } | Failure;
const fail = (code: string): Failure => ({ _tag: "Failure", code });
const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const identityAlgorithms = [
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
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const Token = Schema.Struct({
  access_token: text,
  refresh_token: Schema.optional(text),
  id_token: Schema.optional(text),
  token_type: text,
  expires_in: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive()),
  scope: Schema.optional(text),
});
const Models = Schema.Struct({
  models: Schema.Array(Schema.Struct({ slug: text, display_name: text, visibility: text })),
});
const Request = Schema.Struct({
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  input: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100_000)),
  expectedClientId: text,
});
const IdInput = Schema.Struct({
  clientId: Schema.NullOr(text),
  enablePlan: Schema.optional(Schema.Boolean),
});
const terminalRefreshErrors = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function responseFailure(value: unknown, response: Response): Failure {
  const body = object(value);
  const error = object(body?.error);
  const candidateCode =
    typeof error?.code === "string"
      ? error.code
      : typeof body?.error === "string"
        ? body.error
        : "request-failed";
  const code = /^[a-z][a-z0-9_.-]{0,127}$/.test(candidateCode) ? candidateCode : "request-failed";
  const recovery: Failure["recovery"] =
    code === "subscription_sharing_usage_limit_exceeded"
      ? "usage-limit"
      : code === "subscription_sharing_usage_unavailable" ||
          code === "subscription_sharing_user_unavailable"
        ? "unavailable"
        : code === "subscription_sharing_user_not_eligible"
          ? "ineligible"
          : code === "subscription_sharing_unsupported_capability" ||
              code === "subscription_sharing_route_not_supported"
            ? "unsupported"
            : code === "chatpass_v2_scope_not_authorized" ||
                code === "chatpass_v2_invalid_authorization_context"
              ? "permission"
              : code === "subscription_sharing_invalid_user" || response.status === 401
                ? "identity"
                : response.status === 403
                  ? "permission"
                  : response.status === 429
                    ? "rate-limit"
                    : "unavailable";
  return {
    _tag: "Failure",
    code,
    recovery,
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
async function boundedText(response: Response, limit = 2_000_000): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  while (true) {
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
async function jsonResponse(response: Response): Promise<unknown> {
  const raw = await boundedText(response);
  if (raw === null) return { detail: "response-too-large" };
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({ try: (): unknown => JSON.parse(raw), catch: () => fail("invalid-json") }),
    ),
  );
  return Either.isRight(parsed) ? parsed.right : { detail: raw.slice(0, 2000) };
}

export function registerChatGptLocal(trustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  const enabled = process.env.RECALL_CHATGPT_LOCAL_ENABLED === "true";
  const credentialPath = join(app.getPath("userData"), "chatgpt-local", "credentials.enc");
  let store: LocalStore | null = null;
  let busy = false;
  let inferenceGeneration = 0;
  let inferenceController: AbortController | null = null;
  const usagePaused = new Set<string>();
  let pendingSignIn = false;
  let queue: Promise<unknown> = Promise.resolve();
  const protect = async <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({ try: operation, catch: () => fail("local-chatgpt-unavailable") }),
      ),
    );
    return Either.isRight(result) ? result.right : result.left;
  };
  const secureAvailable = async () =>
    safeStorage.getSelectedStorageBackend() !== "basic_text" &&
    (await safeStorage.isAsyncEncryptionAvailable());
  async function load(): Promise<Reply<LocalStore>> {
    if (!enabled) return fail("local-chatgpt-disabled");
    if (!(await secureAvailable())) return fail("secure-storage-unavailable");
    if (store) return { _tag: "Success", value: store };
    const file = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => readFile(credentialPath),
          catch: (error) => (object(error)?.code === "ENOENT" ? "missing" : "unreadable"),
        }),
      ),
    );
    if (Either.isLeft(file)) {
      if (file.left !== "missing") return fail("credential-storage-failed");
      store = { hostId: `urn:uuid:${randomUUID()}`, activeClientId: null, accounts: [] };
      await save(store);
      return { _tag: "Success", value: store };
    }
    const decrypted = await safeStorage.decryptStringAsync(file.right);
    const parsed = Effect.runSync(
      Effect.either(
        Effect.try({
          try: (): unknown => JSON.parse(decrypted.result),
          catch: () => fail("credential-storage-failed"),
        }),
      ),
    );
    if (Either.isLeft(parsed)) return parsed.left;
    const decoded = Schema.decodeUnknownEither(Store)(parsed.right);
    if (
      Either.isLeft(decoded) ||
      new Set(decoded.right.accounts.map((account) => account.clientId)).size !==
        decoded.right.accounts.length
    )
      return fail("credential-storage-failed");
    store = {
      ...decoded.right,
      accounts: decoded.right.accounts.map((account, index) => ({
        ...account,
        label: account.label ?? `ChatGPT account ${index + 1}`,
      })),
    };
    if (decrypted.shouldReEncrypt || decoded.right.accounts.some((account) => !account.label))
      await save(store);
    return { _tag: "Success", value: store };
  }
  async function save(next: LocalStore): Promise<void> {
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(next));
    const directory = join(app.getPath("userData"), "chatgpt-local");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${credentialPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" });
    await rename(temporary, credentialPath);
    store = next;
  }
  async function update(account: LocalAccount, activate = false): Promise<void> {
    if (!store) return;
    await save({
      ...store,
      activeClientId: activate ? account.clientId : store.activeClientId,
      accounts: [...store.accounts.filter((item) => item.clientId !== account.clientId), account],
    });
  }
  const serialize = <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => {
    const result = queue.then(() => protect(operation));
    queue = result;
    return result;
  };
  async function tokenRequest(
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Reply<typeof Token.Type>> {
    const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
      method: "POST",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters),
    });
    const raw = await jsonResponse(response);
    if (!response.ok) return responseFailure(raw, response);
    const decoded = Schema.decodeUnknownEither(Token)(raw);
    return Either.isRight(decoded) &&
      decoded.right.token_type.toLowerCase() === "bearer" &&
      Number.isSafeInteger(Date.now() + decoded.right.expires_in * 1000)
      ? { _tag: "Success", value: decoded.right }
      : fail("invalid-token-response");
  }
  async function activeAccount(signal?: AbortSignal): Promise<Reply<LocalAccount>> {
    const loaded = await load();
    if (loaded._tag === "Failure") return loaded;
    let account = loaded.value.accounts.find(
      (item) => item.clientId === loaded.value.activeClientId,
    );
    if (!account?.credentials) return fail("sign-in-required");
    if (!account.credentials.scopes.includes("chatgpt.tokens.use.direct"))
      return fail("plan-permission-required");
    if (account.credentials.expiresAt < Date.now() + 60_000) {
      if (!account.credentials.refreshToken) return fail("refresh-permission-required");
      const refreshParameters = {
        grant_type: "refresh_token",
        client_id: account.clientId,
        refresh_token: account.credentials.refreshToken,
        resource,
      };
      let refreshed = await protect(() => tokenRequest(refreshParameters, signal));
      for (
        let attempt = 0;
        attempt < 2 &&
        !signal?.aborted &&
        refreshed._tag === "Failure" &&
        (refreshed.code === "local-chatgpt-unavailable" || (refreshed.status ?? 0) >= 500);
        attempt += 1
      ) {
        await Effect.runPromise(Effect.sleep(500 * 2 ** attempt));
        refreshed = await protect(() => tokenRequest(refreshParameters, signal));
      }
      if (refreshed._tag === "Failure") {
        if (terminalRefreshErrors.has(refreshed.code))
          await update({ ...account, credentials: null });
        return refreshed;
      }
      const value = refreshed.value;
      if (!value.refresh_token) return fail("incomplete-token-response");
      if (value.id_token) {
        const identity = await jwtVerify(value.id_token, jwks, {
          issuer,
          audience: account.clientId,
          algorithms: identityAlgorithms,
          requiredClaims: ["sub", "exp", "iat"],
          clockTolerance: 5,
        });
        if (
          identity.payload.sub !== account.subject ||
          typeof identity.payload.iat !== "number" ||
          !Number.isSafeInteger(identity.payload.iat) ||
          identity.payload.iat > Date.now() / 1000 + 5
        )
          return fail("identity-mismatch");
      }
      account = {
        ...account,
        credentials: {
          accessToken: value.access_token,
          refreshToken: value.refresh_token,
          idToken: value.id_token ?? account.credentials.idToken,
          expiresAt: Date.now() + value.expires_in * 1000,
          scopes: value.scope?.split(/\s+/).filter(Boolean) ?? account.credentials.scopes,
        },
      };
      await update(account);
    }
    if (!account.credentials?.scopes.includes("chatgpt.tokens.use.direct"))
      return fail("plan-permission-required");
    return { _tag: "Success", value: account };
  }
  async function signIn(input: typeof IdInput.Type): Promise<Reply<boolean>> {
    if (pendingSignIn) return fail("sign-in-in-progress");
    pendingSignIn = true;
    try {
      const loaded = await serialize(load);
      if (loaded._tag === "Failure") return loaded;
      const selected =
        input.clientId === null
          ? null
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
        server.once("error", () => resolve(false));
        server.listen(0, "127.0.0.1", () => resolve(true));
      });
      if (!listening) return fail("callback-listener-unavailable");
      const timer = setTimeout(() => resolveCallback(null), 180_000);
      try {
        const address = server.address();
        if (!address || typeof address === "string") return fail("callback-listener-unavailable");
        const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
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
          label:
            selected?.label ??
            store?.accounts.find((item) => item.clientId === clientId)?.label ??
            `ChatGPT account ${(store?.accounts.length ?? 0) + 1}`,
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
        inferenceGeneration += 1;
        inferenceController?.abort();
        return serialize(async () => {
          await update(account, true);
          if (store) await save({ ...store, pendingClientId: null });
          return { _tag: "Success", value: true };
        });
      } finally {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
      }
    } finally {
      pendingSignIn = false;
    }
  }
  async function models(
    signal?: AbortSignal,
  ): Promise<Reply<readonly { readonly slug: string; readonly displayName: string }[]>> {
    const active = await activeAccount(signal);
    if (active._tag === "Failure") return active;
    const response = await fetch(`${resource}/models`, {
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${active.value.credentials?.accessToken ?? ""}` },
    });
    const raw = await jsonResponse(response);
    if (!response.ok) return responseFailure(raw, response);
    const decoded = Schema.decodeUnknownEither(Models)(raw);
    if (Either.isLeft(decoded)) return fail("invalid-model-catalog");
    return {
      _tag: "Success",
      value: decoded.right.models
        .filter((model) => model.visibility === "list")
        .map((model) => ({ slug: model.slug, displayName: model.display_name })),
    };
  }
  async function respond(input: typeof Request.Type): Promise<Reply<string>> {
    if (busy) return fail("inference-in-progress");
    busy = true;
    const controller = new AbortController();
    inferenceController = controller;
    try {
      const active = await activeAccount(controller.signal);
      if (active._tag === "Failure") return active;
      if (active.value.clientId !== input.expectedClientId) return fail("account-changed");
      if (controller.signal.aborted) return fail("inference-cancelled");
      if (usagePaused.has(active.value.clientId))
        return fail("subscription_sharing_usage_limit_exceeded");
      const catalog = await models(controller.signal);
      if (catalog._tag === "Failure") return catalog;
      if (!catalog.value.some((model) => model.slug === input.model))
        return fail("model-unavailable");
      if (controller.signal.aborted) return fail("inference-cancelled");
      const admissionFailure = (raw: unknown, response: Response) => {
        const failure = responseFailure(raw, response);
        if (failure.recovery === "usage-limit") usagePaused.add(active.value.clientId);
        return failure;
      };
      const response = await fetch(`${resource}/responses`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        headers: {
          authorization: `Bearer ${active.value.credentials?.accessToken ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          input: [{ role: "user", content: input.input }],
          store: false,
          stream: true,
        }),
      });
      if (!response.ok) return admissionFailure(await jsonResponse(response), response);
      if (!response.headers.get("content-type")?.includes("text/event-stream"))
        return fail("invalid-stream-type");
      const reader = response.body?.getReader();
      if (!reader) return fail("interrupted-stream");
      const decoder = new TextDecoder();
      let pending = "";
      let output = "";
      let bytes = 0;
      let completed = false;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 2_000_000) return fail("response-too-large");
          pending = (pending + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, "\n");
          let split = pending.indexOf("\n\n");
          while (split >= 0) {
            const frame = pending.slice(0, split);
            pending = pending.slice(split + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data && data !== "[DONE]") {
              const parsed = Effect.runSync(
                Effect.either(
                  Effect.try({
                    try: (): unknown => JSON.parse(data),
                    catch: () => fail("invalid-stream-event"),
                  }),
                ),
              );
              if (Either.isLeft(parsed)) return parsed.left;
              const event = object(parsed.right);
              if (!event) return fail("invalid-stream-event");
              if (event.type === "response.output_text.delta" && typeof event.delta === "string")
                output += event.delta;
              if (event.type === "response.completed") completed = true;
              if (event.type === "response.failed" || event.type === "error") {
                const terminal = object(event.response);
                return admissionFailure(
                  { error: terminal?.error ?? event.error ?? event },
                  response,
                );
              }
              if (event.type === "response.incomplete") return fail("incomplete-response");
            }
            split = pending.indexOf("\n\n");
          }
        }
        return completed ? { _tag: "Success", value: output } : fail("interrupted-stream");
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    } finally {
      inferenceController = null;
      busy = false;
    }
  }
  async function signOut(
    clientId: string,
  ): Promise<Reply<{ readonly remoteRevocationConfirmed: boolean }>> {
    const loaded = await load();
    if (loaded._tag === "Failure") return loaded;
    const account = loaded.value.accounts.find((item) => item.clientId === clientId);
    if (!account) return fail("unknown-account");
    let confirmed = account.credentials === null;
    if (account.credentials?.refreshToken) {
      const revoke = await protect(async () => {
        const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        const metadata = object(await jsonResponse(discovery));
        if (!discovery.ok || typeof metadata?.revocation_endpoint !== "string")
          return fail("revocation-unavailable");
        const endpoint = new URL(metadata.revocation_endpoint);
        if (
          metadata.issuer !== issuer ||
          endpoint.origin !== issuer ||
          endpoint.protocol !== "https:" ||
          endpoint.username ||
          endpoint.password ||
          endpoint.hash
        )
          return fail("invalid-revocation-endpoint");
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result = await protect(async () => {
            const response = await fetch(endpoint, {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(15_000),
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: account.credentials?.refreshToken ?? "",
                token_type_hint: "refresh_token",
                client_id: clientId,
              }),
            });
            return response.status === 200
              ? { _tag: "Success", value: true }
              : responseFailure(await jsonResponse(response), response);
          });
          if (result._tag === "Success") return result;
          if (result.status !== undefined && result.status < 500) return result;
          if (attempt < 2)
            await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
        return fail("revocation-unconfirmed");
      });
      confirmed = revoke._tag === "Success";
    }
    await update({ ...account, credentials: null });
    if (store?.activeClientId === clientId) await save({ ...store, activeClientId: null });
    return { _tag: "Success", value: { remoteRevocationConfirmed: confirmed } };
  }
  ipcMain.handle("chatgpt:status", (event) => {
    if (!trustedSender(event)) return fail("untrusted-sender");
    if (!enabled)
      return { _tag: "Success", value: { enabled: false, activeClientId: null, accounts: [] } };
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      return {
        _tag: "Success",
        value: {
          enabled: true,
          activeClientId: loaded.value.activeClientId,
          accounts: loaded.value.accounts.map((account) => ({
            clientId: account.clientId,
            label: account.label ?? "ChatGPT account",
            email: account.email,
            signedIn: account.credentials !== null,
            usagePaused: usagePaused.has(account.clientId),
            planEnabled: account.credentials?.scopes.includes("chatgpt.tokens.use.direct") ?? false,
          })),
        },
      };
    });
  });
  ipcMain.handle("chatgpt:sign-in", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(IdInput)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    inferenceGeneration += 1;
    inferenceController?.abort();
    return protect(() => signIn(decoded.right));
  });
  ipcMain.handle("chatgpt:select", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    inferenceGeneration += 1;
    inferenceController?.abort();
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      if (
        !loaded.value.accounts.some(
          (account) => account.clientId === decoded.right && account.credentials,
        )
      )
        return fail("sign-in-required");
      await save({ ...loaded.value, activeClientId: decoded.right });
      return { _tag: "Success", value: true };
    });
  });
  ipcMain.handle("chatgpt:sign-out", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    inferenceGeneration += 1;
    inferenceController?.abort();
    return serialize(() => signOut(decoded.right));
  });
  ipcMain.handle("chatgpt:models", (event) =>
    trustedSender(event) ? serialize(() => models()) : fail("untrusted-sender"),
  );
  ipcMain.handle("chatgpt:resume-plan", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      if (loaded.value.activeClientId !== decoded.right) return fail("account-changed");
      usagePaused.delete(decoded.right);
      return { _tag: "Success", value: true };
    });
  });
  ipcMain.handle("chatgpt:respond", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(Request)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    const generation = inferenceGeneration;
    return serialize(async () => {
      if (generation !== inferenceGeneration) return fail("inference-cancelled");
      const result = await protect(() => respond(decoded.right));
      return generation === inferenceGeneration ? result : fail("inference-cancelled");
    });
  });
}
