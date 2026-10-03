import { Effect } from "effect";
import type { Workspace } from "@recall/domain";
import {
  syncWorkspace,
  type WorkspaceMediaGateway,
  type WorkspaceSyncTransport,
  type WorkspaceSyncResult,
  type WorkspaceSyncFailure,
  type WorkspaceSyncInput,
} from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import { withNativeRequest } from "./native-http";

export type NativeSyncResult = WorkspaceSyncResult;
export type NativeSyncBinding = {
  readonly expectedOwnerId: string;
  readonly adoptLegacyOwner?: boolean;
  readonly checkpoint: WorkspaceSyncInput["checkpoint"];
  readonly isCurrent: () => boolean;
};

/** Native composition boundary supplies authenticated HTTP and the operation timestamp. */
export function syncNativeWorkspace(
  workspace: Workspace,
  accessToken: string,
  createId: () => string,
  mediaStore: MediaStore,
  mediaGatewayForOwner: (ownerId: string) => WorkspaceMediaGateway,
  binding: NativeSyncBinding,
): Effect.Effect<NativeSyncResult, WorkspaceSyncFailure> {
  const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL?.trim().replace(/\/$/, "");
  if (!apiUrl || !accessToken)
    return Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "request" });
  const changed = (): WorkspaceSyncFailure => ({
    _tag: "WorkspaceSyncFailure",
    reason: "account-changed",
  });
  const transport: WorkspaceSyncTransport = (request) =>
    Effect.suspend(() => {
      if (!binding.isCurrent())
        return Effect.fail({ _tag: "WorkspaceSyncTransportFailure" } as const);
      return Effect.tryPromise({
        try: () =>
          withNativeRequest(
            `${apiUrl}${request.path}`,
            {
              method: request.method,
              headers: {
                ...request.headers,
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/json",
              },
              ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            },
            async (response) => ({
              status: response.status,
              body: (await response.json()) as unknown,
            }),
          ),
        catch: () => ({ _tag: "WorkspaceSyncTransportFailure" }) as const,
      }).pipe(
        Effect.flatMap((response) =>
          binding.isCurrent()
            ? Effect.succeed(response)
            : Effect.fail({ _tag: "WorkspaceSyncTransportFailure" } as const),
        ),
      );
    });
  const guardMedia = <A>(
    operation: "read" | "upload",
    effect: Effect.Effect<A, import("@recall/application").WorkspaceMediaGatewayFailure>,
  ) =>
    Effect.suspend(() =>
      binding.isCurrent()
        ? effect
        : Effect.fail({
            _tag: "WorkspaceMediaGatewayFailure",
            operation,
            reason: "unavailable",
          } as const),
    ).pipe(
      Effect.flatMap((value) =>
        binding.isCurrent()
          ? Effect.succeed(value)
          : Effect.fail({
              _tag: "WorkspaceMediaGatewayFailure",
              operation,
              reason: "unavailable",
            } as const),
      ),
    );
  return Effect.suspend(() => {
    if (!binding.isCurrent()) return Effect.fail(changed());
    return syncWorkspace({
      workspace,
      now: new Date(),
      createId,
      transport,
      mediaStore,
      mediaGatewayForOwner: (ownerId) => {
        const gateway = mediaGatewayForOwner(ownerId);
        return {
          upload: (asset) => guardMedia("upload", gateway.upload(asset)),
          read: (reference) => guardMedia("read", gateway.read(reference)),
        };
      },
      expectedOwnerId: binding.expectedOwnerId,
      adoptLegacyOwner: binding.adoptLegacyOwner ?? false,
      checkpoint: binding.checkpoint,
    }).pipe(
      Effect.mapError((error) => (binding.isCurrent() ? error : changed())),
      Effect.flatMap((result) =>
        binding.isCurrent() ? Effect.succeed(result) : Effect.fail(changed()),
      ),
    );
  });
}
