import "server-only";

import { Either } from "effect";
import { authenticateSupabaseApiRequest } from "@recall/infra-supabase";
import { readSupabaseConfig } from "./config";
import { createSupabaseServerClient } from "./server";

export type { SupabaseApiAuthResult as ApiAuthResult } from "@recall/infra-supabase";

export function authenticateApiRequest(request: Request) {
  const config = readSupabaseConfig();
  const configuration = Either.isRight(config) ? config.right : null;
  return authenticateSupabaseApiRequest(request, configuration, (activeConfiguration) =>
    createSupabaseServerClient(activeConfiguration.url, activeConfiguration.publishableKey),
  );
}
