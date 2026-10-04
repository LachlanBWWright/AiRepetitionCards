import { contextBridge, ipcRenderer } from "electron";

type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };
type DesktopMediaReply =
  | {
      readonly _tag: "Success";
      readonly value: { readonly status: number; readonly bytes: Uint8Array | null };
    }
  | { readonly _tag: "Failure" };

// Keep a click received during renderer startup until the review hook subscribes.
let pendingReminderOpen = false;
const reminderOpenListeners = new Set<() => void>();
ipcRenderer.on("reminders:open", () => {
  if (reminderOpenListeners.size === 0) pendingReminderOpen = true;
  else for (const callback of reminderOpenListeners) callback();
});

contextBridge.exposeInMainWorld("recallDesktop", {
  chatgpt: {
    status: (): Promise<unknown> => ipcRenderer.invoke("chatgpt:status"),
    signIn: (input: unknown): Promise<unknown> => ipcRenderer.invoke("chatgpt:sign-in", input),
    select: (clientId: string): Promise<unknown> => ipcRenderer.invoke("chatgpt:select", clientId),
    signOut: (clientId: string): Promise<unknown> =>
      ipcRenderer.invoke("chatgpt:sign-out", clientId),
    resumePlan: (clientId: string): Promise<unknown> =>
      ipcRenderer.invoke("chatgpt:resume-plan", clientId),
    models: (): Promise<unknown> => ipcRenderer.invoke("chatgpt:models"),
    usage: (clientId: string): Promise<unknown> => ipcRenderer.invoke("chatgpt:usage", clientId),
    setBudget: (input: unknown): Promise<unknown> =>
      ipcRenderer.invoke("chatgpt:set-budget", input),
    respond: (input: {
      readonly model: string;
      readonly input: string;
      readonly expectedClientId: string;
    }): Promise<unknown> => ipcRenderer.invoke("chatgpt:respond", input),
    research: (input: {
      readonly model: string;
      readonly query: string;
      readonly expectedClientId: string;
    }): Promise<unknown> => ipcRenderer.invoke("chatgpt:research", input),
    openResearchSource: (input: {
      readonly url: string;
      readonly expectedClientId: string;
    }): Promise<unknown> => ipcRenderer.invoke("chatgpt:open-research-source", input),
  },
  reminders: {
    read: (): Promise<unknown> => ipcRenderer.invoke("reminders:read"),
    set: (input: unknown): Promise<unknown> => ipcRenderer.invoke("reminders:set", input),
    onOpen: (callback: () => void): (() => void) => {
      reminderOpenListeners.add(callback);
      if (pendingReminderOpen) {
        pendingReminderOpen = false;
        callback();
      }
      return () => {
        reminderOpenListeners.delete(callback);
      };
    },
  },
  workspace: {
    read: (): Promise<DesktopReply<string | null>> => ipcRenderer.invoke("workspace:read"),
    write: (serializedWorkspace: string): Promise<DesktopReply<void>> =>
      ipcRenderer.invoke("workspace:write", serializedWorkspace),
    clear: (): Promise<DesktopReply<void>> => ipcRenderer.invoke("workspace:clear"),
  },
  media: {
    get: (id: string): Promise<unknown> => ipcRenderer.invoke("media:get", id),
    put: (asset: unknown): Promise<unknown> => ipcRenderer.invoke("media:put", asset),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke("media:delete", id),
    list: (): Promise<unknown> => ipcRenderer.invoke("media:list"),
  },
  auth: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke("auth:status"),
    requestMagicLink: (email: string): Promise<unknown> =>
      ipcRenderer.invoke("auth:magic-link", email),
    signOut: (): Promise<unknown> => ipcRenderer.invoke("auth:sign-out"),
    onStateChanged: (callback: (state: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on("auth:state", listener);
      return () => ipcRenderer.removeListener("auth:state", listener);
    },
    onSignInResult: (callback: (result: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result);
      ipcRenderer.on("auth:callback", listener);
      return () => ipcRenderer.removeListener("auth:callback", listener);
    },
  },
  api: {
    request: (request: {
      readonly path: string;
      readonly method: string;
      readonly body: string | null;
      readonly expectedOwnerId?: string;
    }) => ipcRenderer.invoke("desktop-api:request", request),
    requestMedia: (request: {
      readonly path: string;
      readonly method: "GET" | "POST";
      readonly referenceJson: string | null;
      readonly bytes: Uint8Array | null;
      readonly expectedOwnerId?: string;
    }): Promise<DesktopMediaReply> =>
      ipcRenderer.invoke("desktop-api:request-media", request) as Promise<DesktopMediaReply>,
  },
  anki: {
    readSqlite: (database: Uint8Array): Promise<unknown> =>
      ipcRenderer.invoke("anki:read-sqlite", database),
  },
  backup: {
    save: (bytes: Uint8Array): Promise<unknown> => ipcRenderer.invoke("backup:save", bytes),
    open: (): Promise<unknown> => ipcRenderer.invoke("backup:open"),
  },
});
