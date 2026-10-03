import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { Effect, Either, Schema } from "effect";
import { WorkspaceAreaTombstoneRequestSchema } from "@recall/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import { tombstoneKnowledgeAreas } from "@recall/infra-supabase/area-tombstones";

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return privateJson({ error: auth.reason }, { status });
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", { request });
  if (limited) return limited;
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 64_000)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return privateJson(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const requestValue = Schema.decodeUnknownEither(WorkspaceAreaTombstoneRequestSchema)(body.right);
  const tombstones = Either.isRight(requestValue) ? requestValue.right.areaTombstones : null;
  if (
    tombstones === null ||
    new Set(tombstones.map(({ areaId }) => areaId)).size !== tombstones.length
  ) {
    return privateJson({ error: "invalid-tombstones" }, { status: 400 });
  }

  const databaseTombstones = await Effect.runPromise(Effect.either(toDatabaseJson(tombstones)));
  if (Either.isLeft(databaseTombstones))
    return privateJson({ error: "invalid-tombstones" }, { status: 400 });
  const saved = await Effect.runPromise(
    Effect.either(tombstoneKnowledgeAreas(auth.client, databaseTombstones.right)),
  );
  if (Either.isLeft(saved)) return privateJson({ error: "tombstone-save-failed" }, { status: 502 });
  if (saved.right._tag === "Conflict")
    return privateJson({ error: "area-content-conflict" }, { status: 409 });
  return privateJson({ deletedAreaIds: tombstones.map(({ areaId }) => areaId) });
}

export const POST = observeRoute("workspace-area-delete", handlePOST);
