import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { MediaReference } from "@recall/domain";
import { verifyMediaAsset } from "@recall/application";
import { ipcMain, safeStorage } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

const DesktopRequestSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(512)),
  method: Schema.Literal("GET", "POST", "PATCH", "DELETE"),
  body: Schema.NullOr(Schema.String.pipe(Schema.maxLength(5_000_000))),
  expectedOwnerId: Schema.optional(Schema.UUID),
});
const DesktopApiPathPatterns = {
  GET: /^\/api\/v1\/(?:workspace|sync(?:\?cursor=\d{1,20})?|tutor(?:\?sessionId=[0-9a-f-]{1,80})?|tutor\/privacy|account\/export|published\/[0-9a-f-]{36}(?:\/updates(?:\?(?:sourceAreaId=[0-9a-f-]{36}(?:&token=[A-Za-z0-9_-]{43})?|token=[A-Za-z0-9_-]{43}))?|\?token=[A-Za-z0-9_-]{43})?)$/i,
  POST: /^\/api\/v1\/(?:workspace|sync|workspace\/(?:area-tombstones|review-identities)|tutor|account\/delete|knowledge-areas|published\/[0-9a-f-]{36}\/fork)$/i,
  DELETE: /^\/api\/v1\/tutor\/privacy$/i,
  PATCH: /^\/api\/v1\/tutor$|^\/api\/v1\/published\/[0-9a-f-]{36}\/token$/i,
} as const;
const DesktopMediaRequestSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(512)),
  method: Schema.Union(Schema.Literal("GET"), Schema.Literal("POST")),
  referenceJson: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_048))),
  bytes: Schema.NullOr(Schema.Uint8ArrayFromSelf),
  expectedOwnerId: Schema.optional(Schema.UUID),
});
const maxPublishedMediaBytes = 20_000_000;
const maxApiResponseBytes = 25_000_000;
const apiRequestTimeoutMs = 60_000;
const publishedMediaGetPattern =
  /^\/api\/v1\/published\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/media\/([a-f0-9]{64})(?:\?token=([A-Za-z0-9_-]{43}))?$/i;
const publishedMediaPostPattern = /^\/api\/v1\/publishing\/media\/([a-f0-9]{64})$/;
const workspaceMediaPattern = /^\/api\/v1\/workspace\/media\/([a-f0-9]{64})$/;
type DesktopMediaRequest = typeof DesktopMediaRequestSchema.Type;
export type DesktopMediaResponse = { readonly status: number; readonly bytes: Uint8Array | null };
export type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };
export type DesktopAuthStatus = {
  readonly configured: boolean;
  readonly email: string | null;
  readonly ownerId: string | null;
  readonly secureStorageAvailable: boolean;
};
export type DesktopApiResponse = { readonly status: number; readonly body: string };

type CredentialFailure = { readonly _tag: "CredentialStorageFailure" };
type AuthFailure = { readonly _tag: "DesktopAuthFailure" };
type ApiFailure = { readonly _tag: "DesktopApiFailure" };

async function readBoundedResponseText(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxApiResponseBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxApiResponseBytes ? new TextDecoder().decode(bytes) : null;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxApiResponseBytes) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

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

  function publishAuthState(email: string | null, ownerId: string | null): void {
    getWindow()?.webContents.send("auth:state", { email, ownerId });
  }

  if (authClient) {
    authClient.auth.onAuthStateChange((_event, session) => {
      publishAuthState(session?.user.email ?? null, session?.user.id ?? null);
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
        value: { configured: false, email: null, ownerId: null, secureStorageAvailable: false },
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
        ownerId: sessionResult.right.data.session?.user.id ?? null,
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
                signal: AbortSignal.timeout(apiRequestTimeoutMs),
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                  ...(decoded.right.expectedOwnerId
                    ? { "x-recall-workspace-owner": decoded.right.expectedOwnerId }
                    : {}),
                },
                ...(decoded.right.body === null ? {} : { body: decoded.right.body }),
              });
              const body = await readBoundedResponseText(response);
              if (body === null) {
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

  const mediaRequest = async (
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<DesktopReply<DesktopMediaResponse>> => {
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

    let expectedMediaId: string | null = null;
    if (mediaRequest.method === "GET") {
      const publishedMatch = publishedMediaGetPattern.exec(mediaRequest.path);
      const workspaceMatch = workspaceMediaPattern.exec(mediaRequest.path);
      const mediaId = publishedMatch?.[2] ?? workspaceMatch?.[1];
      if (!mediaId || mediaRequest.bytes !== null || mediaId !== reference.id) return failure();
      expectedMediaId = mediaId;
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
      expectedMediaId = match[1];
    }
    if (expectedMediaId === null) return failure();

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
            while (true) {
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
        const tokenHashes = url.searchParams.getAll("token_hash");
        const types = url.searchParams.getAll("type");
        const tokenHash = tokenHashes[0];
        if (
          tokenHashes.length !== 1 ||
          types.length !== 1 ||
          !tokenHash ||
          tokenHash.length > 2_000 ||
          types[0] !== "email"
        ) {
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
  ipcMain.handle("desktop-api:request-media", mediaRequest);

  return { handleAuthUrl };
}
