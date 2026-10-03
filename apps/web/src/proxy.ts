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
  const response = await refreshSupabaseSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy.header);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
