import { Effect } from "effect";
import type { AiAccessSelection } from "./ai-access";
import type { ManagedAiStatus } from "./managed-ai-client";

export type AiFundingPorts = {
  readonly read: (owner: string) => Effect.Effect<string | null, { readonly message: string }>;
  readonly write: (
    owner: string,
    mode: AiAccessSelection,
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly status: (owner: string) => Effect.Effect<ManagedAiStatus, { readonly message: string }>;
};
export type AiFundingSnapshot = {
  readonly owner: string | null;
  readonly mode: AiAccessSelection;
  readonly status: ManagedAiStatus | null;
  readonly message: string | null;
  readonly checking: boolean;
};
export function managedAiUnavailableReason(state: AiFundingSnapshot): string | null {
  if (!state.owner) return "Sign in to Recall to use managed AI.";
  if (state.checking) return "Checking your managed AI allowance…";
  if (state.message) return state.message;
  if (!state.status?.available)
    return "Managed AI is not enabled for this account. Ask the operator for access.";
  if (
    state.status.usedMicrousd >= state.status.dailyLimitMicrousd ||
    state.status.requestsUsed >= state.status.requestLimit
  )
    return "Your daily managed AI allowance has been reached.";
  return null;
}
/** One immutable account identity per store. Dispose prevents late work from publishing to a new view. */
export function createAiFundingStore(owner: string | null, ports: AiFundingPorts) {
  const lane = Effect.runSync(Effect.makeSemaphore(1));
  const listeners = new Set<() => void>();
  let disposed = false;
  let preferenceRevision = 0;
  let explicitSelection = false;
  let statusRevision = 0;
  let snapshot: AiFundingSnapshot = {
    owner,
    mode: "byo",
    status: null,
    message: null,
    checking: owner !== null,
  };
  const publish = (update: Partial<AiFundingSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...update };
    for (const listener of listeners) listener();
  };
  const refresh = () =>
    Effect.suspend(() => {
      if (!owner || disposed) return Effect.void;
      const revision = ++statusRevision;
      publish({ checking: true, status: null, message: null });
      return ports.status(owner).pipe(
        Effect.match({
          onFailure: (error) => {
            if (revision === statusRevision)
              publish({ checking: false, status: null, message: error.message });
          },
          onSuccess: (status) => {
            if (revision !== statusRevision) return;
            publish(
              status.accountId === owner
                ? { checking: false, status, message: null }
                : { checking: false, status: null, message: "The selected account changed." },
            );
          },
        }),
      );
    });
  const loadPreference = Effect.suspend(() => {
    if (!owner || disposed) return Effect.void;
    const revision = preferenceRevision;
    return ports.read(owner).pipe(
      Effect.match({
        onFailure: (error) => {
          if (!explicitSelection && revision === preferenceRevision)
            publish({ mode: "byo", message: error.message });
        },
        onSuccess: (mode) => {
          if (!explicitSelection && revision === preferenceRevision)
            publish({ mode: mode === "managed" ? "managed" : "byo" });
        },
      }),
    );
  });
  const select = (mode: AiAccessSelection) =>
    Effect.suspend(() => {
      if (!owner || disposed) return Effect.void;
      explicitSelection = true;
      const revision = ++preferenceRevision;
      return lane
        .withPermits(1)(Effect.suspend(() => (disposed ? Effect.void : ports.write(owner, mode))))
        .pipe(
          Effect.match({
            onFailure: (error) => {
              if (revision === preferenceRevision) publish({ message: error.message });
            },
            onSuccess: () => {
              if (revision === preferenceRevision) publish({ mode });
            },
          }),
        );
    });
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: Effect.suspend(() => {
      disposed = false;
      return Effect.all([loadPreference, refresh()], { concurrency: "unbounded" }).pipe(
        Effect.asVoid,
      );
    }),
    refresh,
    select,
    dispose: () => {
      disposed = true;
      preferenceRevision++;
      statusRevision++;
      listeners.clear();
    },
  };
}
