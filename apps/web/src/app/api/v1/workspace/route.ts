import { createHash, randomUUID } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { KnowledgeAreaSchema } from "@recall/domain";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const StoredAreaSchema = Schema.Struct({
  id: Schema.String,
  color: Schema.String,
});
const StoredAreaVersionSchema = Schema.Struct({
  knowledge_area_id: Schema.String,
  version: Schema.Number,
  content: Schema.Unknown,
  content_hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
});

function isValidSyncDocument(document: typeof KnowledgeAreaSchema.Type): boolean {
  if (
    !uuidPattern.test(document.id) ||
    document.cards.length > 500 ||
    document.objectives.length > 200
  ) {
    return false;
  }
  const objectiveIds = new Set(document.objectives.map((objective) => objective.id));
  return (
    [...objectiveIds].every((id) => uuidPattern.test(id)) &&
    document.objectives.every((objective) =>
      objective.prerequisiteIds.every((id) => objectiveIds.has(id)),
    ) &&
    document.cards.every(
      (card) =>
        uuidPattern.test(card.id) &&
        card.kind === "basic" &&
        card.objectiveIds.every((id) => objectiveIds.has(id)),
    )
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function documentHash(document: typeof KnowledgeAreaSchema.Type): string {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const connected = await authenticateApiRequest(request);
  if (connected._tag === "ContextError") {
    const status =
      connected.reason === "not-configured"
        ? 503
        : connected.reason === "unauthenticated"
          ? 401
          : 502;
    return NextResponse.json({ error: connected.reason }, { status });
  }

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 5_000_000)));
  if (
    Either.isLeft(body) ||
    typeof body.right !== "object" ||
    body.right === null ||
    !("areas" in body.right)
  ) {
    const tooLarge = Either.isLeft(body) && body.left.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const rawAreas = body.right.areas;
  const rawTombstones = "tombstones" in body.right ? body.right.tombstones : [];
  if (
    !Array.isArray(rawAreas) ||
    rawAreas.length > 100 ||
    !Array.isArray(rawTombstones) ||
    rawTombstones.length > 2_000
  ) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const areas: Array<{
    document: typeof KnowledgeAreaSchema.Type;
    color: string;
    baseContentHash: string | null;
  }> = [];
  const areaIds = new Set<string>();
  const cardIds = new Set<string>();
  const objectiveIds = new Set<string>();
  let cardCount = 0;
  for (const rawArea of rawAreas) {
    if (
      typeof rawArea !== "object" ||
      rawArea === null ||
      !("document" in rawArea) ||
      !("color" in rawArea)
    ) {
      return NextResponse.json({ error: "invalid-content" }, { status: 400 });
    }
    const decoded = Schema.decodeUnknownEither(KnowledgeAreaSchema)(rawArea.document);
    const color = rawArea.color;
    const baseContentHash = "baseContentHash" in rawArea ? rawArea.baseContentHash : null;
    if (
      Either.isLeft(decoded) ||
      !isValidSyncDocument(decoded.right) ||
      typeof color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(color) ||
      (baseContentHash !== null &&
        (typeof baseContentHash !== "string" || !/^[a-f0-9]{64}$/i.test(baseContentHash)))
    ) {
      return NextResponse.json({ error: "invalid-content" }, { status: 400 });
    }
    if (areaIds.has(decoded.right.id))
      return NextResponse.json({ error: "duplicate-area-id" }, { status: 400 });
    areaIds.add(decoded.right.id);
    for (const objective of decoded.right.objectives) {
      if (objectiveIds.has(objective.id))
        return NextResponse.json({ error: "duplicate-objective-id" }, { status: 400 });
      objectiveIds.add(objective.id);
    }
    for (const card of decoded.right.cards) {
      if (cardIds.has(card.id))
        return NextResponse.json({ error: "duplicate-card-id" }, { status: 400 });
      cardIds.add(card.id);
    }
    cardCount += decoded.right.cards.length;
    if (cardCount > 2_000) return NextResponse.json({ error: "batch-too-large" }, { status: 413 });
    areas.push({ document: decoded.right, color, baseContentHash });
  }

  const payload = areas.map(({ document, color, baseContentHash }) => ({
    id: document.id,
    title: document.title,
    description: document.description,
    language: document.language,
    color,
    tags: document.tags,
    objectives: document.objectives,
    cards: document.cards.map((card) => ({ ...card, revisionId: randomUUID() })),
    document,
    versionId: randomUUID(),
    contentHash: documentHash(document),
    baseContentHash,
  }));
  const tombstonesSchema = Schema.Array(
    Schema.Struct({ areaId: Schema.String, cardId: Schema.String }),
  );
  const decodedTombstones = Schema.decodeUnknownEither(tombstonesSchema)(rawTombstones);
  if (
    Either.isLeft(decodedTombstones) ||
    decodedTombstones.right.some(
      ({ areaId, cardId }) => !uuidPattern.test(areaId) || !uuidPattern.test(cardId),
    )
  ) {
    return NextResponse.json({ error: "invalid-tombstones" }, { status: 400 });
  }
  if (areaIds.size > 0) {
    const deletedAreas = await connected.client
      .from("knowledge_areas")
      .select("id")
      .in("id", [...areaIds])
      .not("deleted_at", "is", null);
    if (deletedAreas.error)
      return NextResponse.json({ error: "content-sync-failed" }, { status: 502 });
    if ((deletedAreas.data ?? []).length > 0)
      return NextResponse.json({ error: "area-deleted-on-server" }, { status: 409 });
  }
  const tombstoneSet = new Set(decodedTombstones.right.map(({ cardId }) => cardId));
  const filteredPayload = payload.map((area) => {
    const cards = area.cards.filter((card) => !tombstoneSet.has(card.id));
    const document = {
      ...area.document,
      cards: area.document.cards.filter((card) => !tombstoneSet.has(card.id)),
    };
    return {
      ...area,
      cards,
      document,
      contentHash: documentHash(document),
    };
  });
  const saved = await connected.client.rpc("sync_workspace_content", {
    p_areas: filteredPayload,
    p_tombstones: decodedTombstones.right,
  });
  if (saved.error) return NextResponse.json({ error: "content-sync-failed" }, { status: 502 });
  if (saved.data !== true) return NextResponse.json({ error: "content-conflict" }, { status: 409 });
  return NextResponse.json({ syncedAreas: areas.length, syncedCards: cardCount });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const connected = await authenticateApiRequest(request);
  if (connected._tag === "ContextError") {
    const status =
      connected.reason === "not-configured"
        ? 503
        : connected.reason === "unauthenticated"
          ? 401
          : 502;
    return NextResponse.json({ error: connected.reason }, { status });
  }

  const areasResult = await connected.client
    .from("knowledge_areas")
    .select("id, color")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (areasResult.error)
    return NextResponse.json({ error: "workspace-read-failed" }, { status: 502 });
  const deletedAreasResult = await connected.client
    .from("knowledge_areas")
    .select("id")
    .not("deleted_at", "is", null);
  if (deletedAreasResult.error)
    return NextResponse.json({ error: "workspace-read-failed" }, { status: 502 });
  const deletedAreaIds = Schema.decodeUnknownEither(Schema.Array(Schema.String))(
    (deletedAreasResult.data ?? []).map((area) => area.id),
  );
  if (Either.isLeft(deletedAreaIds))
    return NextResponse.json({ error: "workspace-response-invalid" }, { status: 502 });
  const decodedAreas = Schema.decodeUnknownEither(Schema.Array(StoredAreaSchema))(
    areasResult.data ?? [],
  );
  if (Either.isLeft(decodedAreas))
    return NextResponse.json({ error: "workspace-response-invalid" }, { status: 502 });
  if (decodedAreas.right.length === 0)
    return NextResponse.json({ areas: [], deletedAreaIds: deletedAreaIds.right });

  const versionsResult = await connected.client
    .from("knowledge_area_versions")
    .select("knowledge_area_id, version, content")
    .in(
      "knowledge_area_id",
      decodedAreas.right.map((area) => area.id),
    )
    .order("version", { ascending: false });
  if (versionsResult.error)
    return NextResponse.json({ error: "workspace-read-failed" }, { status: 502 });
  const versions = Schema.decodeUnknownEither(Schema.Array(StoredAreaVersionSchema))(
    versionsResult.data ?? [],
  );
  if (Either.isLeft(versions))
    return NextResponse.json({ error: "workspace-response-invalid" }, { status: 502 });

  const latestVersionByArea = new Map<
    string,
    { readonly content: unknown; readonly contentHash: string }
  >();
  for (const version of versions.right) {
    if (!latestVersionByArea.has(version.knowledge_area_id))
      latestVersionByArea.set(version.knowledge_area_id, {
        content: version.content,
        contentHash: version.content_hash,
      });
  }
  const documents = [];
  for (const area of decodedAreas.right) {
    const document = Schema.decodeUnknownEither(KnowledgeAreaSchema)(
      latestVersionByArea.get(area.id)?.content,
    );
    if (Either.isLeft(document) || document.right.id !== area.id)
      return NextResponse.json({ error: "workspace-response-invalid" }, { status: 502 });
    const contentHash = latestVersionByArea.get(area.id)?.contentHash;
    if (!contentHash)
      return NextResponse.json({ error: "workspace-response-invalid" }, { status: 502 });
    documents.push({ document: document.right, color: area.color, contentHash });
  }
  return NextResponse.json({ areas: documents, deletedAreaIds: deletedAreaIds.right });
}
