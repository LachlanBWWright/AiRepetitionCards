export type DesktopAuthStatus = {
  readonly configured: boolean;
  readonly email: string | null;
  readonly ownerId: string | null;
  readonly secureStorageAvailable: boolean;
};

export type DesktopApiResponse = {
  readonly status: number;
  readonly body: string;
};

const apiRequestTimeoutMs = 60_000;

declare global {
  interface Window {
    readonly recallDesktop?: {
      readonly chatgpt?: {
        readonly status: () => Promise<unknown>;
        readonly signIn: (input: unknown) => Promise<unknown>;
        readonly select: (clientId: string) => Promise<unknown>;
        readonly signOut: (clientId: string) => Promise<unknown>;
        readonly resumePlan: (clientId: string) => Promise<unknown>;
        readonly models: () => Promise<unknown>;
        readonly respond: (input: {
          readonly model: string;
          readonly input: string;
          readonly expectedClientId?: string;
        }) => Promise<unknown>;
      };
      readonly workspace: {
        readonly read: () => Promise<unknown>;
        readonly write: (serializedWorkspace: string) => Promise<unknown>;
        readonly clear: () => Promise<unknown>;
      };
      readonly media: {
        readonly get: (id: string) => Promise<unknown>;
        readonly put: (asset: unknown) => Promise<unknown>;
        readonly delete: (id: string) => Promise<unknown>;
        readonly list: () => Promise<unknown>;
      };
      readonly auth: {
        readonly getStatus: () => Promise<unknown>;
        readonly requestMagicLink: (email: string) => Promise<unknown>;
        readonly signOut: () => Promise<unknown>;
        readonly onStateChanged: (callback: (state: unknown) => void) => () => void;
        readonly onSignInResult: (callback: (result: unknown) => void) => () => void;
      };
      readonly api: {
        readonly request: (request: {
          readonly path: string;
          readonly method: string;
          readonly body: string | null;
          readonly expectedOwnerId?: string;
        }) => Promise<unknown>;
        readonly requestMedia: (request: {
          readonly path: string;
          readonly method: "GET" | "POST";
          readonly referenceJson: string | null;
          readonly bytes: Uint8Array | null;
          readonly expectedOwnerId?: string;
        }) => Promise<unknown>;
      };
      readonly anki: {
        readonly readSqlite: (database: Uint8Array) => Promise<unknown>;
      };
      readonly backup: {
        readonly save: (bytes: Uint8Array) => Promise<unknown>;
        readonly open: () => Promise<unknown>;
      };
    };
  }
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.recallDesktop !== undefined;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const bridge = typeof window === "undefined" ? undefined : window.recallDesktop;
  if (!bridge) {
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const abortFromCaller = () => controller.abort();
    let cleanedUp = false;
    const clearCallerSignal = () => {
      externalSignal?.removeEventListener("abort", abortFromCaller);
    };
    const timeout = setTimeout(() => {
      controller.abort();
      if (!cleanedUp) {
        cleanedUp = true;
        clearCallerSignal();
      }
    }, apiRequestTimeoutMs);
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      clearCallerSignal();
    };
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    let response: Response;
    try {
      response = await fetch(path, { ...init, signal: controller.signal });
    } catch (error) {
      cleanup();
      return Promise.reject(error);
    }
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanup();
            reader.releaseLock();
            streamController.close();
          } else {
            streamController.enqueue(chunk.value);
          }
        } catch (error) {
          cleanup();
          streamController.error(error);
        }
      },
      async cancel(reason) {
        cleanup();
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    });
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  const body = typeof init?.body === "string" ? init.body : null;
  const expectedOwnerId = new Headers(init?.headers).get("x-recall-workspace-owner");
  const raw = await bridge.api.request({
    path,
    method,
    body,
    ...(expectedOwnerId === null ? {} : { expectedOwnerId }),
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("_tag" in raw) ||
    raw._tag !== "Success" ||
    !("value" in raw)
  ) {
    return Response.json({ error: "desktop-api-unavailable" }, { status: 503 });
  }
  const value = raw.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    value.status < 100 ||
    value.status > 599 ||
    !("body" in value) ||
    typeof value.body !== "string"
  ) {
    return Response.json({ error: "desktop-api-invalid-response" }, { status: 502 });
  }
  return new Response(value.body, {
    status: value.status,
    headers: { "content-type": "application/json" },
  });
}
