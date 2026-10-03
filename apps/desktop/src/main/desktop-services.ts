import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Effect, Either, Schema } from "effect";
import { ipcMain, safeStorage } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

const DesktopRequestSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(512)),
  method: Schema.Union(Schema.Literal("GET"), Schema.Literal("POST"), Schema.Literal("PATCH")),
  body: Schema.NullOr(Schema.String.pipe(Schema.maxLength(5_000_000))),
});
const DesktopApiPathPatterns = {
  GET: /^\/api\/v1\/(?:workspace|sync(?:\?cursor=\d{1,20})?|tutor(?:\?sessionId=[0-9a-f-]{1,80})?|account\/export)$/i,
  POST: /^\/api\/v1\/(?:workspace|sync|workspace\/area-tombstones|tutor|account\/delete)$/,
  PATCH: /^\/api\/v1\/tutor$/,
} as const;
export type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };
export type DesktopAuthStatus = {
  readonly configured: boolean;
  readonly email: string | null;
  readonly secureStorageAvailable: boolean;
};
export type DesktopApiResponse = { readonly status: number; readonly body: string };

type CredentialFailure = { readonly _tag: "CredentialStorageFailure" };
type AuthFailure = { readonly _tag: "DesktopAuthFailure" };
type ApiFailure = { readonly _tag: "DesktopApiFailure" };

const secureStorageAvailability = (): Effect.Effect<boolean, CredentialFailure> =>
  Effect.tryPromise({
    try: async () =>
      safeStorage.getSelectedStorageBackend() !== "basic_text" &&
      (await safeStorage.isAsyncEncryptionAvailable()),
    catch: (): CredentialFailure => ({ _tag: "CredentialStorageFailure" }),
  });

function failure<T>(): DesktopReply<T> {
  return { _tag: "Failure" };
}

function makeAuthClient(database: DatabaseSync): {
  readonly client: SupabaseClient | null;
  readonly storageHealthy: () => boolean;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return { client: null, storageHealthy: () => false };
  let storageFailure = false;

  const readCredential = (name: string): Effect.Effect<string | null, CredentialFailure> =>
    Effect.flatMap(
      Effect.try({
        try: (): unknown =>
          database
            .prepare("SELECT encrypted_value FROM secure_credentials WHERE name = ?")
            .get(name),
        catch: () => ({ _tag: "CredentialStorageFailure" }) as const,
      }),
      (row) => {
        if (row === undefined) return Effect.succeed(null);
        if (
          typeof row !== "object" ||
          row === null ||
          !("encrypted_value" in row) ||
          typeof row.encrypted_value !== "string"
        ) {
          return Effect.fail({ _tag: "CredentialStorageFailure" });
        }
        const encryptedValue = row.encrypted_value;
        return Effect.mapError(
          Effect.tryPromise({
            try: async () => {
              const decoded = await safeStorage.decryptStringAsync(
                Buffer.from(encryptedValue, "base64"),
              );
              if (decoded.shouldReEncrypt) {
                const encrypted = await safeStorage.encryptStringAsync(decoded.result);
                database
                  .prepare("UPDATE secure_credentials SET encrypted_value = ? WHERE name = ?")
                  .run(encrypted.toString("base64"), name);
              }
              return decoded.result;
            },
            catch: () => ({ _tag: "CredentialStorageFailure" }) as const,
          }),
          () => ({ _tag: "CredentialStorageFailure" }) as const,
        );
      },
    );

  const writeCredential = (
    name: string,
    value: string | null,
  ): Effect.Effect<void, CredentialFailure> =>
    Effect.flatMap(
      Effect.tryPromise({
        try: async () => {
          if (value === null) {
            database.prepare("DELETE FROM secure_credentials WHERE name = ?").run(name);
            return true;
          }
          if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
          const encrypted = await safeStorage.encryptStringAsync(value);
          database
            .prepare(
              `INSERT INTO secure_credentials (name, encrypted_value) VALUES (?, ?)
               ON CONFLICT(name) DO UPDATE SET encrypted_value = excluded.encrypted_value`,
            )
            .run(name, encrypted.toString("base64"));
          return true;
        },
        catch: () => ({ _tag: "CredentialStorageFailure" }) as const,
      }),
      (written) => (written ? Effect.void : Effect.fail({ _tag: "CredentialStorageFailure" })),
    );

  const storage = {
    getItem: async (name: string): Promise<string | null> => {
      const result = await Effect.runPromise(Effect.either(readCredential(name)));
      if (Either.isLeft(result)) {
        storageFailure = true;
        return null;
      }
      return result.right;
    },
    setItem: async (name: string, value: string): Promise<void> => {
      const result = await Effect.runPromise(Effect.either(writeCredential(name, value)));
      if (Either.isLeft(result)) storageFailure = true;
    },
    removeItem: async (name: string): Promise<void> => {
      const result = await Effect.runPromise(Effect.either(writeCredential(name, null)));
      if (Either.isLeft(result)) storageFailure = true;
    },
  };

  return {
    client: createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage,
      },
    }),
    storageHealthy: () => !storageFailure,
  };
}

export function registerDesktopServices(
  database: DatabaseSync,
  getWindow: () => BrowserWindow | null,
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
  recallApiUrl: string | undefined,
): { readonly handleAuthUrl: (value: string) => Promise<boolean> } {
  const secureAuth = makeAuthClient(database);
  const authClient = secureAuth.client;

  function publishAuthState(email: string | null): void {
    getWindow()?.webContents.send("auth:state", { email });
  }

  if (authClient) {
    authClient.auth.onAuthStateChange((_event, session) => {
      publishAuthState(session?.user.email ?? null);
    });
  }

  async function currentAccessToken(): Promise<string | null> {
    if (!authClient) return null;
    const sessionResult = await authClient.auth.getSession();
    if (sessionResult.error) return null;
    const activeSession = sessionResult.data.session;
    if (!activeSession) return null;
    if ((activeSession.expires_at ?? 0) > Math.floor(Date.now() / 1000) + 30) {
      return activeSession.access_token;
    }
    const refreshed = await authClient.auth.refreshSession();
    return refreshed.error ? null : (refreshed.data.session?.access_token ?? null);
  }

  const status = async (): Promise<DesktopReply<DesktopAuthStatus>> => {
    if (!authClient) {
      return {
        _tag: "Success",
        value: { configured: false, email: null, secureStorageAvailable: false },
      };
    }
    const availability = await Effect.runPromise(Effect.either(secureStorageAvailability()));
    if (Either.isLeft(availability)) return failure();
    const sessionResult = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: (): AuthFailure => ({ _tag: "DesktopAuthFailure" }),
        }),
      ),
    );
    if (Either.isLeft(sessionResult) || sessionResult.right.error) return failure();
    return {
      _tag: "Success",
      value: {
        configured: true,
        email: sessionResult.right.data.session?.user.email ?? null,
        secureStorageAvailable: availability.right && secureAuth.storageHealthy(),
      },
    };
  };

  const requestMagicLink = async (
    event: IpcMainInvokeEvent,
    email: unknown,
  ): Promise<DesktopReply<boolean>> => {
    if (!trustedSender(event)) return failure();
    const decoded = Schema.decodeUnknownEither(
      Schema.String.pipe(Schema.maxLength(254), Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
    )(email);
    if (Either.isLeft(decoded) || !authClient) return failure();
    const available = await Effect.runPromise(Effect.either(secureStorageAvailability()));
    if (Either.isLeft(available) || !available.right || !secureAuth.storageHealthy()) {
      return failure();
    }
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () =>
            authClient.auth.signInWithOtp({
              email: decoded.right,
              options: { emailRedirectTo: "recall://auth/confirm" },
            }),
          catch: (): AuthFailure => ({ _tag: "DesktopAuthFailure" }),
        }),
      ),
    );
    if (Either.isLeft(result) || result.right.error || !secureAuth.storageHealthy())
      return failure();
    return { _tag: "Success", value: true };
  };

  const signOut = async (event: IpcMainInvokeEvent): Promise<DesktopReply<boolean>> => {
    if (!trustedSender(event) || !authClient) return failure();
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.signOut(),
          catch: (): AuthFailure => ({ _tag: "DesktopAuthFailure" }),
        }),
      ),
    );
    if (Either.isLeft(result) || result.right.error) return failure();
    return { _tag: "Success", value: true };
  };

  const apiRequest = async (
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<DesktopReply<DesktopApiResponse>> => {
    if (!trustedSender(event) || !authClient || !recallApiUrl) return failure();
    const decoded = Schema.decodeUnknownEither(DesktopRequestSchema)(input);
    if (Either.isLeft(decoded)) return failure();
    if (!DesktopApiPathPatterns[decoded.right.method].test(decoded.right.path)) return failure();
    const baseUrl = Effect.try({
      try: () => new URL(recallApiUrl),
      catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
    });
    const url = Effect.flatMap(baseUrl, (base) =>
      Effect.try({
        try: () => {
          const loopback =
            base.hostname === "localhost" ||
            base.hostname === "127.0.0.1" ||
            base.hostname === "[::1]";
          if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) {
            return null;
          }
          const target = new URL(decoded.right.path, base);
          return target.origin === base.origin ? target : null;
        },
        catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
      }),
    );
    const result = await Effect.runPromise(
      Effect.either(
        Effect.flatMap(url, (target) => {
          if (target === null) return Effect.fail({ _tag: "DesktopApiFailure" } as const);
          return Effect.tryPromise({
            try: async () => {
              const token = await currentAccessToken();
              if (!token) {
                return { status: 401, body: JSON.stringify({ error: "unauthenticated" }) };
              }
              const response = await fetch(target, {
                method: decoded.right.method,
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                },
                ...(decoded.right.body === null ? {} : { body: decoded.right.body }),
              });
              const body = await response.text();
              if (Buffer.byteLength(body, "utf8") > 25_000_000) {
                return { status: 502, body: JSON.stringify({ error: "response-too-large" }) };
              }
              if (decoded.right.path === "/api/v1/account/delete" && response.ok) {
                await authClient.auth.signOut();
              }
              return { status: response.status, body };
            },
            catch: (): ApiFailure => ({ _tag: "DesktopApiFailure" }),
          });
        }),
      ),
    );
    if (Either.isLeft(result)) return failure();
    return { _tag: "Success", value: result.right };
  };

  async function handleAuthUrl(value: string): Promise<boolean> {
    if (!authClient) return false;
    const callback = Effect.flatMap(
      Effect.try({
        try: () => new URL(value),
        catch: (): AuthFailure => ({ _tag: "DesktopAuthFailure" }),
      }),
      (url) => {
        if (url.protocol !== "recall:" || url.hostname !== "auth" || url.pathname !== "/confirm") {
          return Effect.succeed(false);
        }
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        if (!tokenHash || tokenHash.length > 2_000 || type !== "email") {
          return Effect.succeed(false);
        }
        return Effect.map(
          Effect.tryPromise({
            try: () => authClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" }),
            catch: (): AuthFailure => ({ _tag: "DesktopAuthFailure" }),
          }),
          (result) => result.error === null,
        );
      },
    );
    const result = await Effect.runPromise(Effect.either(callback));
    return Either.isRight(result) && result.right;
  }

  ipcMain.handle("auth:status", async (event): Promise<DesktopReply<DesktopAuthStatus>> =>
    trustedSender(event) ? status() : failure(),
  );
  ipcMain.handle("auth:magic-link", (event, email: unknown) => requestMagicLink(event, email));
  ipcMain.handle("auth:sign-out", signOut);
  ipcMain.handle("desktop-api:request", apiRequest);

  return { handleAuthUrl };
}
