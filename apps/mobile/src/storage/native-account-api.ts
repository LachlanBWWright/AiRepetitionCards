import {
  deleteAccountData,
  exportAccountData,
  type AccountApi,
  type AccountRequestFailure,
} from "@recall/application";
import type { Workspace } from "@recall/domain";
import { Effect, Either } from "effect";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { supabaseAuthClient } from "./supabase-auth";
import { withNativeRequest } from "./native-http";

export type NativeAccountActionFailure = {
  readonly _tag: "NativeAccountActionFailure";
  readonly reason:
    "not-configured" | "unauthenticated" | "request-failed" | "response-invalid" | "file-failed";
};

const fail = (reason: NativeAccountActionFailure["reason"]): NativeAccountActionFailure => ({
  _tag: "NativeAccountActionFailure",
  reason,
});
const maxAccountExportBytes = 50 * 1024 * 1024;

function readBoundedJson(response: Response): Effect.Effect<unknown, AccountRequestFailure> {
  return Effect.tryPromise({
    try: async () => {
      const reader = response.body?.getReader();
      if (!reader) return null;
      const decoder = new TextDecoder();
      let byteLength = 0;
      let document = "";
      let complete = false;
      while (!complete) {
        const chunk = await reader.read();
        complete = chunk.done;
        if (!chunk.done) {
          byteLength += chunk.value.byteLength;
          if (byteLength > maxAccountExportBytes) {
            await reader.cancel();
            return null;
          }
          document += decoder.decode(chunk.value, { stream: true });
        }
      }
      document += decoder.decode();
      return JSON.parse(document) as unknown;
    },
    catch: () => requestFailure("response-invalid"),
  });
}

async function accessToken(): Promise<string | null> {
  const client = supabaseAuthClient;
  if (!client) return null;
  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => client.auth.getSession(),
        catch: () => ({ _tag: "AccountSessionReadFailure" }) as const,
      }),
    ),
  );
  return Either.isRight(result) ? (result.right.data.session?.access_token ?? null) : null;
}

function apiUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_RECALL_API_URL?.trim().replace(/\/$/, "");
  return value && value.length > 0 ? value : null;
}

const requestFailure = (reason: AccountRequestFailure["reason"]): AccountRequestFailure => ({
  _tag: "AccountRequestFailure",
  reason,
});

function requestAccount(
  path: string,
  confirmation?: "DELETE",
): Effect.Effect<unknown, AccountRequestFailure> {
  return Effect.gen(function* () {
    const baseUrl = apiUrl();
    if (!baseUrl) return yield* Effect.fail(requestFailure("not-configured"));
    const token = yield* Effect.tryPromise({
      try: accessToken,
      catch: () => requestFailure("unauthenticated"),
    });
    if (!token) return yield* Effect.fail(requestFailure("unauthenticated"));
    const result = yield* Effect.tryPromise({
      try: () =>
        withNativeRequest(
          `${baseUrl}${path}`,
          {
            method: confirmation ? "POST" : "GET",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            ...(confirmation ? { body: JSON.stringify({ confirmation }) } : {}),
          },
          async (response) => ({
            ok: response.ok,
            status: response.status,
            body: response.ok
              ? await Effect.runPromise(Effect.either(readBoundedJson(response)))
              : null,
          }),
        ),
      catch: () => requestFailure("request-failed"),
    });
    if (!result.ok)
      return yield* Effect.fail(
        requestFailure(result.status === 401 ? "unauthenticated" : "request-failed"),
      );
    if (!result.body || Either.isLeft(result.body))
      return yield* Effect.fail(requestFailure("response-invalid"));
    return result.body.right;
  });
}

const nativeAccountApi: AccountApi = {
  exportData: () => requestAccount("/api/v1/account/export"),
  deleteAccount: (confirmation) => requestAccount("/api/v1/account/delete", confirmation),
};

export function exportNativeAccountData(
  workspace: Workspace | null,
): Effect.Effect<void, NativeAccountActionFailure> {
  return Effect.gen(function* () {
    const cloudData = yield* exportAccountData(nativeAccountApi).pipe(
      Effect.mapError((error) => fail(error.reason)),
    );
    const available = yield* Effect.tryPromise({
      try: () => Sharing.isAvailableAsync(),
      catch: () => fail("file-failed"),
    });
    if (!available) return yield* Effect.fail(fail("file-failed"));
    const exportDocument = { ...cloudData, nativeWorkspace: workspace };
    const file = yield* Effect.try({
      try: () => {
        const destination = new File(
          Paths.cache,
          `recall-account-export-${cloudData.exportedAt.slice(0, 10)}.json`,
        );
        destination.write(JSON.stringify(exportDocument, null, 2));
        return destination;
      },
      catch: () => fail("file-failed"),
    });
    yield* Effect.tryPromise({
      try: () =>
        Sharing.shareAsync(file.uri, {
          mimeType: "application/json",
          dialogTitle: "Recall account export",
        }),
      catch: () => fail("file-failed"),
    });
  });
}

export function deleteNativeAccount(): Effect.Effect<void, NativeAccountActionFailure> {
  return deleteAccountData(nativeAccountApi, "DELETE").pipe(
    Effect.mapError((error) =>
      fail(error._tag === "AccountConfirmationInvalid" ? "response-invalid" : error.reason),
    ),
  );
}
