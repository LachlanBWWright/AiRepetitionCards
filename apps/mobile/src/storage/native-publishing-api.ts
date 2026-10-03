import { Effect } from "effect";
import { createPublishingApi, type PublishingHttpRequest } from "@recall/application";
import { makeNativePublishedMediaGateway } from "./published-media-gateway";
import { withNativeRequest } from "./native-http";

/** Native transports for the shared publication and verified-media application APIs. */
export function makeNativePublishingClients(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  const publishing = createPublishingApi((request: PublishingHttpRequest) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        return await withNativeRequest(
          `${baseUrl}${request.path}`,
          {
            method: request.method,
            headers: {
              ...(token === null ? {} : { authorization: `Bearer ${token}` }),
              ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          },
          async (response) => {
            try {
              return { status: response.status, body: (await response.json()) as unknown };
            } catch {
              return { status: response.status, body: null };
            }
          },
        );
      },
      catch: () => ({ _tag: "PublishingTransportFailure" }) as const,
    }),
  );
  const media = makeNativePublishedMediaGateway(baseUrl, getAccessToken);
  return { publishing, media };
}
