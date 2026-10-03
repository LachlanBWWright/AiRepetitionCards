import "server-only";
import { createClient } from "@supabase/supabase-js";
import { Either } from "effect";
import type { Database } from "@recall/infra-supabase";
import { readSupabaseConfig } from "@/lib/supabase/config";

/** Zero explicitly disables scheduled retention. Invalid configuration fails closed. */
export function readTutorRetentionPolicy(): { readonly retentionDays: number | null } | null {
  const raw = process.env.TUTOR_TRANSCRIPT_RETENTION_DAYS?.trim() ?? "30";
  if (!/^(?:0|[1-9]\d{0,2})$/.test(raw)) return null;
  const days = Number(raw);
  return days > 365 ? null : { retentionDays: days === 0 ? null : days };
}
export function createTutorPrivacyAdmin() {
  const config = readSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Either.isLeft(config) || !key
    ? null
    : createClient<Database>(config.right.url, key, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
}
