import { contextBridge, ipcRenderer } from "electron";

type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };

contextBridge.exposeInMainWorld("recallDesktop", {
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
    }) => ipcRenderer.invoke("desktop-api:request", request),
  },
});
