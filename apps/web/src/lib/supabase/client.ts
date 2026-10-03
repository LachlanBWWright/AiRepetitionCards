"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Either } from "effect";
import { readSupabaseConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return undefined;
  return createBrowserClient(config.right.url, config.right.publishableKey);
}
