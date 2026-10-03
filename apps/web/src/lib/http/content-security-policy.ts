import { Effect, Either } from "effect";

/** Configuration contributes a single validated origin, never raw CSP text. */
function supabaseConnectionOrigin(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 4096) return null;
  const decoded = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => new URL(input.trim()),
        catch: () => ({ _tag: "InvalidCspOrigin" }) as const,
      }),
    ),
  );
  if (Either.isLeft(decoded)) return null;
  const url = decoded.right;
  if (url.username || url.password) return null;
  const loopback =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.origin : null;
}

export type ContentSecurityPolicy = {
  readonly nonce: string;
  readonly header: string;
};

/** Each invocation creates its own nonce; incoming headers are never an input. */
export function createContentSecurityPolicy(
  supabaseUrl: unknown,
  isDevelopment: boolean,
): ContentSecurityPolicy {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const supabaseOrigin = supabaseConnectionOrigin(supabaseUrl);
  const connectSources = [
    "'self'",
    ...(supabaseOrigin ? [supabaseOrigin] : []),
    ...(isDevelopment ? ["ws:", "wss:"] : []),
  ].join(" ");
  const header = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // React styles, editor colors and existing component libraries use inline CSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return { nonce, header };
}
