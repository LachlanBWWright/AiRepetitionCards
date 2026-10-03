import { NextResponse } from "next/server";

/** JSON response for authenticated APIs; never allow shared or browser caching. */
export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  const vary = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add("Authorization");
  vary.add("Cookie");
  headers.set("vary", [...vary].join(", "));
  return NextResponse.json(body, { ...init, headers });
}
