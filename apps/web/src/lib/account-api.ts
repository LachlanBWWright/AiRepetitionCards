import type { AccountApi, AccountRequestFailure } from "@recall/application";
import { Effect } from "effect";
import { apiFetch } from "./desktop-api";

const maxResponseBytes = 50 * 1024 * 1024;
const failure = (reason: AccountRequestFailure["reason"]): AccountRequestFailure => ({
  _tag: "AccountRequestFailure",
  reason,
});

function request(
  path: string,
  confirmation?: "DELETE",
): Effect.Effect<unknown, AccountRequestFailure> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        apiFetch(
          path,
          confirmation
            ? {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ confirmation }),
              }
            : undefined,
        ),
      catch: () => failure("request-failed"),
    });
    if (!response.ok) {
      yield* Effect.tryPromise({
        try: () => response.body?.cancel() ?? Promise.resolve(),
        catch: () => failure("request-failed"),
      });
      return yield* Effect.fail(
        failure(response.status === 401 ? "unauthenticated" : "request-failed"),
      );
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const reader = response.body?.getReader();
        if (!reader) return null;
        const decoder = new TextDecoder();
        let bytes = 0;
        let document = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxResponseBytes) {
            await reader.cancel();
            return null;
          }
          document += decoder.decode(chunk.value, { stream: true });
        }
        document += decoder.decode();
        return JSON.parse(document) as unknown;
      },
      catch: () => failure("response-invalid"),
    });
  });
}

export const browserAccountApi: AccountApi = {
  exportData: () => request("/api/v1/account/export"),
  deleteAccount: (confirmation) => request("/api/v1/account/delete", confirmation),
};
