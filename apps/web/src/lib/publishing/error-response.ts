import type { PublishingErrorCode, PublishingErrorResponse } from "@recall/contracts";
import { privateJson } from "@/lib/http/private-json";

/** Versioned, typed publication failures never enter shared caches. */
export function publishingErrorResponse(error: PublishingErrorCode, status: number) {
  const body: PublishingErrorResponse = { schemaVersion: 1, error };
  return privateJson(body, { status });
}
