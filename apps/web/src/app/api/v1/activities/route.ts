import { Effect, Either, Schema } from "effect";
import { type NextRequest } from "next/server";
import { ActivityLibrarySchema } from "@recall/domain";
import { mergeActivityLibraries } from "@recall/application";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { createLearningActivityAdmin } from "@/lib/supabase/learning-activity-admin";
import { privateJson } from "@/lib/http/private-json";
import { readJsonBody } from "@/lib/http/read-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
const Snapshot = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  library: ActivityLibrarySchema,
});
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      { status: supabaseApiAuthFailureStatus(auth.reason) },
    );
  const expectedOwner = request.headers.get("x-recall-owner");
  if (expectedOwner && expectedOwner !== auth.userId)
    return privateJson({ error: "The selected account changed." }, { status: 401 });
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", { request });
  if (limited) return limited;
  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => auth.client.rpc("read_learning_activities"),
        catch: () => ({ message: "Storage unavailable" }),
      }).pipe(
        Effect.flatMap((reply) =>
          reply.error
            ? Effect.fail({ message: "Storage unavailable" })
            : Schema.decodeUnknown(Snapshot)(reply.data),
        ),
      ),
    ),
  );
  return Either.isRight(result)
    ? privateJson(result.right)
    : privateJson({ error: "Activity storage unavailable." }, { status: 503 });
}
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      { status: supabaseApiAuthFailureStatus(auth.reason) },
    );
  const expectedOwner = request.headers.get("x-recall-owner");
  if (expectedOwner && expectedOwner !== auth.userId)
    return privateJson({ error: "The selected account changed." }, { status: 401 });
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", { request });
  if (limited) return limited;
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 5_000_000)));
  if (Either.isLeft(body))
    return privateJson({ error: "Invalid activity request." }, { status: 400 });
  const input = Schema.decodeUnknownEither(Snapshot)(body.right);
  if (Either.isLeft(input))
    return privateJson({ error: "Invalid activity library." }, { status: 400 });
  const admin = createLearningActivityAdmin();
  if (!admin)
    return privateJson(
      { error: "Activity cloud storage is not configured. Keep your local work." },
      { status: 503 },
    );
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const read = yield* Effect.tryPromise({
          try: () => auth.client.rpc("read_learning_activities"),
          catch: () => ({ message: "Storage unavailable" }),
        });
        if (read.error) return yield* Effect.fail({ message: "Storage unavailable" });
        const current = yield* Schema.decodeUnknown(Snapshot)(read.data);
        if (current.revision !== input.right.revision) return { error: "conflict" } as const;
        const referencedAreas = (library: typeof input.right.library) => [
          ...library.activities.map((entry) => entry.areaId),
          ...library.attempts.map((entry) => entry.activity.areaId),
          ...(library.drafts ?? []).map((entry) => entry.activity.areaId),
          ...(library.editorDrafts ?? []).map((entry) => entry.areaId),
        ];
        const existingAreas = new Set(referencedAreas(current.library));
        const newAreas = [...new Set(referencedAreas(input.right.library))].filter(
          (areaId) => !existingAreas.has(areaId),
        );
        if (newAreas.length > 0) {
          const owned = yield* Effect.tryPromise({
            try: () =>
              auth.client
                .from("knowledge_areas")
                .select("id")
                .eq("owner_id", auth.userId)
                .is("deleted_at", null)
                .in("id", newAreas),
            catch: () => ({ message: "Deck ownership could not be checked" }),
          });
          if (owned.error || owned.data.length !== newAreas.length)
            return yield* Effect.fail({
              message: "Sync these decks to this account before uploading their activities.",
            });
        }
        const merged = yield* mergeActivityLibraries(input.right.library, current.library);
        const json = yield* toDatabaseJson(merged);
        const written = yield* Effect.tryPromise({
          try: () =>
            admin.rpc("write_learning_activities", {
              p_user_id: auth.userId,
              p_revision: current.revision,
              p_library: json,
            }),
          catch: () => ({ message: "Storage unavailable" }),
        });
        if (written.error) return yield* Effect.fail({ message: "Storage unavailable" });
        return written.data;
      }),
    ),
  );
  if (Either.isLeft(result))
    return privateJson(
      { error: "Activity save failed. Keep your local work and retry." },
      { status: 503 },
    );
  const saved = Schema.decodeUnknownEither(Snapshot)(result.right);
  if (Either.isLeft(saved))
    return privateJson({ error: "Activities changed on another device." }, { status: 409 });
  return privateJson(saved.right);
}
