import { Effect } from "effect";
import { createDeckSharingApi } from "@recall/application";
import { withNativeRequest } from "./native-http";

export function makeNativeDeckSharingApi(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
  expectedOwner?: string,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createDeckSharingApi((request) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        return withNativeRequest(
          `${baseUrl}${request.path}`,
          {
            method: request.method,
            headers: {
              ...(token ? { authorization: `Bearer ${token}` } : {}),
              ...(expectedOwner ? { "x-recall-owner": expectedOwner } : {}),
              ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          },
          async (response) => ({
            status: response.status,
            body: (await response.json()) as unknown,
          }),
        );
      },
      catch: () => ({ _tag: "DeckSharingTransportFailure" }) as const,
    }),
  );
}
