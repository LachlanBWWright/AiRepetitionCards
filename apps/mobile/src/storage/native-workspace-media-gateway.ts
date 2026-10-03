import { Effect } from "effect";
import { withNativeRequest } from "./native-http";
import { createWorkspaceMediaGateway, type WorkspaceMediaHttpRequest } from "@recall/application";

const maxMediaBytes = 20_000_000;

/** Secure-session bearer transport for private workspace media synchronization. */
export function makeNativeWorkspaceMediaGateway(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
  expectedOwnerId?: string,
  isCurrent?: () => boolean,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createWorkspaceMediaGateway((request: WorkspaceMediaHttpRequest) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        if (!token || isCurrent?.() === false) return { status: 401, body: null };
        const headers = new Headers(request.headers);
        if (expectedOwnerId) headers.set("x-recall-workspace-owner", expectedOwnerId);
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
              const bytes = new Uint8Array(await response.arrayBuffer());
              return bytes.byteLength > maxMediaBytes
                ? { status: 502, body: null }
                : { status: response.status, body: bytes };
            }
            try {
              return { status: response.status, body: (await response.json()) as unknown };
            } catch {
              return { status: response.status, body: null };
            }
          },
        );
      },
      catch: () => ({ _tag: "WorkspaceMediaTransportFailure" }) as const,
    }),
  );
}
