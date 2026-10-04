import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { Effect, Either } from "effect";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

function shellPolicy() {
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
        catch: () => null,
      }),
    ),
  );
  const url = Either.isRight(parsed) ? parsed.right : null;
  const local =
    url &&
    (url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  const origin =
    url &&
    !url.username &&
    !url.password &&
    (url.protocol === "https:" || (url.protocol === "http:" && local))
      ? ` ${url.origin}`
      : "";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${origin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@recall/ui-web"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/app-shell/:path*",
        headers: [{ key: "Content-Security-Policy", value: shellPolicy() }],
      },
      {
        source: "/index.html",
        headers: [{ key: "Content-Security-Policy", value: shellPolicy() }],
      },
      {
        source: "/service-worker.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
