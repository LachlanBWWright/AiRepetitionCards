import { Effect } from "effect";
import { createPublishedMediaGateway, type PublishedMediaHttpRequest } from "@recall/application";
import { isDesktopRuntime } from "@/lib/desktop-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const publishedMediaGateway = createPublishedMediaGateway(
  (request: PublishedMediaHttpRequest) =>
    Effect.tryPromise({
      try: async () => {
        if (isDesktopRuntime()) {
          const bridge = window.recallDesktop;
          if (!bridge) return { status: 503, body: null };
          const raw = await bridge.api.requestMedia({
            path: request.path,
            method: request.method,
            referenceJson: request.headers?.["x-recall-media-reference"] ?? null,
            bytes: request.body?.slice() ?? null,
          });
          if (
            !isRecord(raw) ||
            raw._tag !== "Success" ||
            !isRecord(raw.value) ||
            typeof raw.value.status !== "number" ||
            !Number.isInteger(raw.value.status) ||
            !(raw.value.bytes === null || raw.value.bytes instanceof Uint8Array)
          ) {
            return { status: 502, body: null };
          }
          const bodyBytes = raw.value.bytes;
          if (request.responseType === "bytes") {
            return { status: raw.value.status, body: bodyBytes };
          }
          if (bodyBytes === null) return { status: raw.value.status, body: null };
          try {
            return {
              status: raw.value.status,
              body: JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown,
            };
          } catch {
            return { status: raw.value.status, body: null };
          }
        }

        const response = await fetch(request.path, {
          method: request.method,
          ...(request.headers === undefined ? {} : { headers: request.headers }),
          ...(request.body === undefined ? {} : { body: request.body.slice().buffer }),
        });
        if (request.responseType === "bytes") {
          return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
        }
        try {
          return { status: response.status, body: (await response.json()) as unknown };
        } catch {
          return { status: response.status, body: null };
        }
      },
      catch: () => ({ _tag: "PublishedMediaTransportFailure" }) as const,
    }),
);
