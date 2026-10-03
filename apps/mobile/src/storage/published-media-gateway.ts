import { Effect } from "effect";
import { withNativeRequest } from "./native-http";
import { createPublishedMediaGateway, type PublishedMediaHttpRequest } from "@recall/application";

const maxPublishedMediaBytes = 20_000_000;

/** Native transport for the shared, hash-verifying published-media gateway. */
export function makeNativePublishedMediaGateway(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createPublishedMediaGateway((request: PublishedMediaHttpRequest) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        const headers = new Headers(request.headers);
        if (token !== null) headers.set("authorization", `Bearer ${token}`);
        return await withNativeRequest(
          `${baseUrl}${request.path}`,
          {
            method: request.method,
            headers,
            ...(request.body === undefined ? {} : { body: request.body.slice().buffer }),
          },
          async (response) => {
            if (request.responseType === "bytes") {
              const body = new Uint8Array(await response.arrayBuffer());
              return {
                status: body.byteLength > maxPublishedMediaBytes ? 502 : response.status,
                body: body.byteLength > maxPublishedMediaBytes ? null : body,
              };
            }
            try {
              return { status: response.status, body: (await response.json()) as unknown };
            } catch {
              return { status: response.status, body: null };
            }
          },
        );
      },
      catch: () => ({ _tag: "PublishedMediaTransportFailure" }) as const,
    }),
  );
}
