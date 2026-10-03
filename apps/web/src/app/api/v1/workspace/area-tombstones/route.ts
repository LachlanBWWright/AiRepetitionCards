import { Effect, Either, Schema } from "effect";
import { AreaTombstonesSchema } from "@recall/contracts";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status =
      auth.reason === "not-configured" ? 503 : auth.reason === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: auth.reason }, { status });
  }
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 64_000)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const requestValue =
    typeof body.right === "object" && body.right !== null && "areaTombstones" in body.right
      ? body.right.areaTombstones
      : body.right;
  const tombstones = Schema.decodeUnknownEither(AreaTombstonesSchema)(requestValue);
  if (
    Either.isLeft(tombstones) ||
    tombstones.right.length > 100 ||
    new Set(tombstones.right.map(({ areaId }) => areaId)).size !== tombstones.right.length
  ) {
    return NextResponse.json({ error: "invalid-tombstones" }, { status: 400 });
  }

  const saved = await auth.client.rpc("tombstone_knowledge_areas", {
    p_area_tombstones: tombstones.right,
  });
  if (saved.error) return NextResponse.json({ error: "tombstone-save-failed" }, { status: 502 });
  if (saved.data !== true)
    return NextResponse.json({ error: "area-content-conflict" }, { status: 409 });
  return NextResponse.json({ deletedAreaIds: tombstones.right.map(({ areaId }) => areaId) });
}
