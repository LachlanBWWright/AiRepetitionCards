"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Effect } from "effect";
import { selectTutorModel } from "@recall/application";
import { createLocalChatGPTConnectionStore } from "./local-chatgpt-connection-store";
import { readLocalChatGPTConnection } from "./read-local-chatgpt-connection";
import { setModel } from "./chat-model-selection";
import "@/lib/desktop-api";

type ConnectionStore = ReturnType<typeof createLocalChatGPTConnectionStore>;
const unavailableMessage =
  "ChatGPT connection service is unavailable. Reopen the app to reconnect.";
const unavailableConnection = createLocalChatGPTConnectionStore({
  read: () => Effect.fail(unavailableMessage),
  onModels: () => {},
});
unavailableConnection.withoutBridge(unavailableMessage);
const ConnectionContext = createContext<ConnectionStore>(unavailableConnection);

export function LocalChatGPTConnectionProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(() =>
    createLocalChatGPTConnectionStore({
      read: readLocalChatGPTConnection,
      onModels: (models) => {
        setModel((current) => selectTutorModel(models, current));
      },
    }),
  );
  useEffect(() => {
    const bridge = window.recallDesktop?.chatgpt;
    if (!bridge) {
      store.withoutBridge();
      return;
    }
    Effect.runFork(store.ensure(bridge).pipe(Effect.ignore));
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === store) return;
      Effect.runFork(store.refresh(bridge, true).pipe(Effect.ignore));
    };
    window.addEventListener("recall-chatgpt-plan-state-changed", changed);
    window.addEventListener("online", changed);
    return () => {
      window.removeEventListener("recall-chatgpt-plan-state-changed", changed);
      window.removeEventListener("online", changed);
    };
  }, [store]);
  return <ConnectionContext.Provider value={store}>{children}</ConnectionContext.Provider>;
}

export function useLocalChatGPTConnection() {
  const store = useContext(ConnectionContext);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return { ...snapshot, store };
}
