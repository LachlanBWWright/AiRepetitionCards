import "server-only";
import { Effect } from "effect";

/** Service-only RPCs: authenticated clients cannot mint grants or refund their own usage. */
export function managedAiRpc(name: string, body: Readonly<Record<string, unknown>>) {
  return Effect.tryPromise({
    try: async (signal): Promise<unknown> => {
      const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return null;
      const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        cache: "no-store",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    },
    catch: () => ({ _tag: "AiBudgetUnavailable" }) as const,
  });
}
