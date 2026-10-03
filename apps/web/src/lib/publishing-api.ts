import { Effect } from "effect";
import { createPublishingApi } from "@recall/application";
import { apiFetch } from "@/lib/desktop-api";

export const publishingApi = createPublishingApi((request) =>
  Effect.tryPromise({
    try: async () => {
      const response = await apiFetch(request.path, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      });
      let body: unknown = null;
      try {
        body = (await response.json()) as unknown;
      } catch {
        body = null;
      }
      return { status: response.status, body };
    },
    catch: () => ({ _tag: "PublishingTransportFailure" }) as const,
  }),
);
