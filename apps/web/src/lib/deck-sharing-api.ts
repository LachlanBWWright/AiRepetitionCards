import { Effect } from "effect";
import { createDeckSharingApi } from "@recall/application";
import { apiFetch } from "@/lib/desktop-api";

export function createBrowserDeckSharingApi(expectedOwner?: string) {
  return createDeckSharingApi((request) =>
    Effect.tryPromise({
      try: async () => {
        const response = await apiFetch(request.path, {
          method: request.method,
          headers: {
            ...(expectedOwner ? { "x-recall-owner": expectedOwner } : {}),
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
        const body: unknown = await response.json();
        return { status: response.status, body };
      },
      catch: () => ({ _tag: "DeckSharingTransportFailure" }) as const,
    }),
  );
}

export const deckSharingApi = createBrowserDeckSharingApi();
