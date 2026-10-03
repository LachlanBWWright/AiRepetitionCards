export type DesktopAuthStatus = {
  readonly configured: boolean;
  readonly email: string | null;
  readonly secureStorageAvailable: boolean;
};

export type DesktopApiResponse = {
  readonly status: number;
  readonly body: string;
};

declare global {
  interface Window {
    readonly recallDesktop?: {
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
        }) => Promise<unknown>;
      };
    };
  }
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.recallDesktop !== undefined;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const bridge = typeof window === "undefined" ? undefined : window.recallDesktop;
  if (!bridge) return fetch(path, init);

  const method = init?.method?.toUpperCase() ?? "GET";
  const body = typeof init?.body === "string" ? init.body : null;
  const raw = await bridge.api.request({ path, method, body });
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
