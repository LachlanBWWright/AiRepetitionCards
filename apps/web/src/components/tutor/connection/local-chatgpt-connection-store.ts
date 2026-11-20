import { Effect } from "effect";
import type { Models, LocalChatGPTState } from "./local-chatgpt-status";
import type { readLocalChatGPTConnection } from "./read-local-chatgpt-connection";

type Bridge = Parameters<typeof readLocalChatGPTConnection>[0];
type Catalog = typeof Models.Type;
export type LocalChatGPTConnectionSnapshot = {
  readonly state: LocalChatGPTState | null;
  readonly models: Catalog;
  readonly message: string | null;
  readonly checking: boolean;
};
const initialSnapshot: LocalChatGPTConnectionSnapshot = {
  state: null,
  models: [],
  message: null,
  checking: true,
};

/** One app-owned connection check; UI panels only subscribe to its current result. */
export function createLocalChatGPTConnectionStore({
  read,
  onModels,
}: {
  readonly read: typeof readLocalChatGPTConnection;
  readonly onModels: (models: Catalog) => void;
}) {
  let snapshot = initialSnapshot;
  let revision = 0;
  let initialized = false;
  let activeBridge: Bridge | null = null;
  let pending: Effect.Effect<void, string> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: LocalChatGPTConnectionSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => {
      listener();
    });
  };
  const invalidate = () => {
    revision += 1;
    initialized = false;
    pending = null;
    onModels([]);
    publish(initialSnapshot);
  };
  const refresh = (bridge: Bridge, force = false): Effect.Effect<void, string> =>
    Effect.suspend(() => {
      if (!force && activeBridge === bridge && pending) return pending;
      const current = ++revision;
      activeBridge = bridge;
      initialized = true;
      publish({ ...snapshot, checking: true });
      const operation = read(bridge, (state) => {
        if (current === revision) publish({ ...snapshot, state });
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (current !== revision) return;
            onModels(result.models);
            publish({ ...result, checking: false });
          }),
        ),
        Effect.tapError((message) =>
          Effect.sync(() => {
            if (current !== revision) return;
            onModels([]);
            publish({ state: null, models: [], message, checking: false });
          }),
        ),
        Effect.asVoid,
        Effect.catchAll((message) => (current === revision ? Effect.fail(message) : Effect.void)),
        Effect.ensuring(
          Effect.sync(() => {
            if (current === revision) pending = null;
          }),
        ),
      );
      pending = Effect.runSync(Effect.cached(operation));
      return pending;
    });
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    refresh,
    invalidate,
    withoutBridge: (message: string | null = null) => {
      publish({ ...initialSnapshot, message, checking: false });
    },
    ensure: (bridge: Bridge): Effect.Effect<void, string> =>
      Effect.suspend(() =>
        initialized && activeBridge === bridge ? (pending ?? Effect.void) : refresh(bridge),
      ),
  };
}
