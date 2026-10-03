import { observeRoute } from "@/lib/http/observe-route";
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { type NextRequest } from "next/server";
import { TutorRetentionResponseSchema } from "@recall/contracts";
import { purgeExpiredTutorHistory } from "@recall/infra-supabase/tutor-privacy";
import { privateJson } from "@/lib/http/private-json";
import { createTutorPrivacyAdmin, readTutorRetentionPolicy } from "@/lib/tutor-privacy-config";

async function handleCleanup(request: NextRequest, secret: string | undefined) {
  if (!secret || !/^[\x21-\x7e]{32,4096}$/.test(secret))
    return privateJson({ error: "retention-unavailable" }, { status: 503 });
  const provided = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(provided), digest(`Bearer ${secret}`))) {
    return privateJson({ error: "unauthenticated" }, { status: 401 });
  }
  const policy = readTutorRetentionPolicy();
  const rawBatch = process.env.TUTOR_RETENTION_BATCH_SIZE?.trim() ?? "250";
  if (policy === null || !/^[1-9]\d{0,3}$/.test(rawBatch) || Number(rawBatch) > 1_000) {
    return privateJson({ error: "retention-unavailable" }, { status: 503 });
  }
  if (policy.retentionDays === null) return privateJson({ schemaVersion: 1, deletedSessions: 0 });
  const admin = createTutorPrivacyAdmin();
  if (admin === null) return privateJson({ error: "retention-unavailable" }, { status: 503 });
  const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000).toISOString();
  const deleted = await Effect.runPromise(
    Effect.either(purgeExpiredTutorHistory(admin, cutoff, Number(rawBatch))),
  );
  if (Either.isLeft(deleted))
    return privateJson({ error: "retention-unavailable" }, { status: 502 });
  const response = Schema.decodeUnknownEither(TutorRetentionResponseSchema)({
    schemaVersion: 1,
    deletedSessions: deleted.right,
  });
  return Either.isLeft(response)
    ? privateJson({ error: "retention-unavailable" }, { status: 502 })
    : privateJson(response.right);
}

export const POST = observeRoute("tutor-retention", (request: NextRequest) =>
  handleCleanup(request, process.env.TUTOR_RETENTION_JOB_SECRET),
);

export const GET = observeRoute("tutor-retention", (request: NextRequest) =>
  handleCleanup(request, process.env.CRON_SECRET),
);

// Prevent Next's automatic HEAD handling from executing the cleanup GET.
export const HEAD = observeRoute(
  "tutor-retention",
  async () =>
    new Response(null, {
      status: 405,
      headers: { Allow: "GET, POST", "Cache-Control": "private, no-store, max-age=0" },
    }),
);
