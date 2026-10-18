import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { jwtVerify } from "jose";
import { Effect, Either, Schema } from "effect";
import {
  Store,
  Token,
  type LocalAccount,
  type LocalStore,
  type Reply,
  fail,
  identityAlgorithms,
  issuer,
  jwks,
  object,
  resource,
  responseFailure,
  terminalRefreshErrors,
  jsonResponse,
} from "../transport/chatgpt-local-protocol";

export function createChatGptLocalAccounts(dependencies: {
  readonly credentialPath: string;
  readonly secureAvailable: () => Promise<boolean>;
  readonly protect: <T>(operation: () => Promise<Reply<T>>) => Promise<Reply<T>>;
  readonly getStore: () => LocalStore | null;
  readonly setStore: (store: LocalStore) => void;
  readonly decrypt: (
    encrypted: Buffer,
  ) => Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }>;
  readonly encrypt: (value: string) => Promise<Buffer>;
}) {
  const { credentialPath, secureAvailable, protect, getStore, setStore, decrypt, encrypt } =
    dependencies;

  async function save(next: LocalStore): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(next));
    const directory = dirname(credentialPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${credentialPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" });
    await rename(temporary, credentialPath);
    setStore(next);
  }

  async function load(): Promise<Reply<LocalStore>> {
    if (!(await secureAvailable())) return fail("secure-storage-unavailable");
    const current = getStore();
    if (current) return { _tag: "Success", value: current };
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
      const initial = { hostId: `urn:uuid:${randomUUID()}`, activeClientId: null, accounts: [] };
      await save(initial);
      return { _tag: "Success", value: initial };
    }
    const decrypted = await decrypt(file.right);
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
    const account =
      decoded.right.accounts.find((item) => item.clientId === decoded.right.activeClientId) ??
      decoded.right.accounts[0];
    const migrated: LocalStore = {
      ...decoded.right,
      activeClientId: account?.credentials ? account.clientId : null,
      accounts: account ? [{ ...account, label: "ChatGPT account" }] : [],
    };
    if (decrypted.shouldReEncrypt || JSON.stringify(migrated) !== JSON.stringify(decoded.right))
      await save(migrated);
    return { _tag: "Success", value: migrated };
  }

  async function update(account: LocalAccount, activate = false): Promise<void> {
    const current = getStore();
    if (!current) return;
    await save({
      ...current,
      activeClientId: activate ? account.clientId : current.activeClientId,
      accounts: [account],
    });
  }

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

  return { load, save, update, tokenRequest, activeAccount } as const;
}
