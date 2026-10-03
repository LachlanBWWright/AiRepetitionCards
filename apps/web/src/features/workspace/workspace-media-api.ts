import { Effect } from "effect";
import { createWorkspaceMediaGateway, type WorkspaceMediaHttpRequest } from "@recall/application";
import { isDesktopRuntime } from "@/lib/desktop-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mediaGateway(expectedOwnerId?: string) {
  return createWorkspaceMediaGateway((request: WorkspaceMediaHttpRequest) =>
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
            ...(expectedOwnerId === undefined ? {} : { expectedOwnerId }),
          });
          if (
            !isRecord(raw) ||
            raw._tag !== "Success" ||
            !isRecord(raw.value) ||
            typeof raw.value.status !== "number" ||
            !(raw.value.bytes === null || raw.value.bytes instanceof Uint8Array)
          ) {
            return { status: 502, body: null };
          }
          if (request.responseType === "bytes") {
            return { status: raw.value.status, body: raw.value.bytes };
          }
          if (raw.value.bytes === null) return { status: raw.value.status, body: null };
          try {
            return {
              status: raw.value.status,
              body: JSON.parse(new TextDecoder().decode(raw.value.bytes)) as unknown,
            };
          } catch {
            return { status: raw.value.status, body: null };
          }
        }

        const response = await fetch(request.path, {
          method: request.method,
          headers: {
            ...request.headers,
            ...(expectedOwnerId === undefined
              ? {}
              : { "x-recall-workspace-owner": expectedOwnerId }),
          },
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
      catch: () => ({ _tag: "WorkspaceMediaTransportFailure" }) as const,
    }),
  );
}

export const workspaceMediaGateway = mediaGateway();

/** Bind every private-media request to the owner verified by the sync snapshot. */
export function createOwnerBoundWorkspaceMediaGateway(ownerId: string) {
  return mediaGateway(ownerId);
}
