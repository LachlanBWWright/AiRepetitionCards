import "server-only";
import { createClient } from "@supabase/supabase-js";
import { Either } from "effect";
import type { Database } from "@recall/infra-supabase";
import { readSupabaseConfig } from "./config";

/** Composed only for the owner-verified, compare-and-set approval linkage adapter. */
export function createTutorApprovalAdmin() {
  const config = readSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Either.isLeft(config) || !key
    ? null
    : createClient<Database>(config.right.url, key, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
}
