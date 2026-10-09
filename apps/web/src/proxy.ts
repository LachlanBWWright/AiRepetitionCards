import type { NextRequest } from "next/server";
import { createContentSecurityPolicy } from "@/lib/http/content-security-policy";
import { refreshSupabaseSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  const policy = createContentSecurityPolicy(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", policy.nonce);
  requestHeaders.set("Content-Security-Policy", policy.header);

  // Keep browser requests same-origin while allowing the ASP.NET API to own
  // API/auth behavior. The hosting ingress can do this routing in production;
  // this proxy keeps the local Next development server usable as the frontend.
  const apiOrigin = process.env.RECALL_API_URL?.trim();
  const isBackendRoute =
    request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/auth/");
  if (apiOrigin && isBackendRoute) {
    let upstream: URL;
    try {
      const configuredOrigin = new URL(apiOrigin);
      if (
        !["http:", "https:"].includes(configuredOrigin.protocol) ||
        configuredOrigin.username.length > 0 ||
        configuredOrigin.password.length > 0 ||
        configuredOrigin.pathname !== "/" ||
        configuredOrigin.search.length > 0 ||
        configuredOrigin.hash.length > 0 ||
        configuredOrigin.origin === request.nextUrl.origin
      ) {
        return new Response("API origin is invalid", {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            Vary: "Authorization, Cookie",
            "Content-Security-Policy": policy.header,
          },
        });
      }
      upstream = new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        `${configuredOrigin.origin}/`,
      );
    } catch {
      return new Response("API origin is invalid", {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Authorization, Cookie",
          "Content-Security-Policy": policy.header,
        },
      });
    }

    requestHeaders.delete("host");
    const connectionHeader = requestHeaders.get("connection");
    for (const token of connectionHeader?.split(",") ?? []) {
      const headerName = token.trim();
      if (headerName.length > 0) requestHeaders.delete(headerName);
    }
    for (const headerName of [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ]) {
      requestHeaders.delete(headerName);
    }
    requestHeaders.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
    requestHeaders.set("x-forwarded-proto", request.nextUrl.protocol.slice(0, -1));
    const method = request.method.toUpperCase();
    let response: Response;
    try {
      response = await fetch(upstream, {
        method,
        headers: requestHeaders,
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: request.body, duplex: "half" as const }),
        cache: "no-store",
        redirect: "manual",
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return Response.json(
        { error: "api-unavailable" },
        {
          status: 502,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            Vary: "Authorization, Cookie",
            "Content-Security-Policy": policy.header,
          },
        },
      );
    }
    const forwarded = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    const location = response.headers.get("location");
    if (location !== null) {
      try {
        const destination = new URL(location, request.nextUrl.origin);
        if (!["http:", "https:"].includes(destination.protocol)) {
          return new Response("API redirect is invalid", {
            status: 502,
            headers: {
              "Cache-Control": "private, no-store, max-age=0",
              Vary: "Authorization, Cookie",
              "Content-Security-Policy": policy.header,
            },
          });
        }
        forwarded.headers.set("location", destination.toString());
      } catch {
        return new Response("API redirect is invalid", {
          status: 502,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            Vary: "Authorization, Cookie",
            "Content-Security-Policy": policy.header,
          },
        });
      }
    }
    forwarded.headers.set("Content-Security-Policy", policy.header);
    return forwarded;
  }

  const response = await refreshSupabaseSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy.header);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|app-shell(?:/|$)|index\\.html$|vendor/|service-worker\\.js$|manifest\\.webmanifest$|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
