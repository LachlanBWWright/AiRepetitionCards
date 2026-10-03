import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { createHash, randomUUID } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { KnowledgeAreaSchema } from "@recall/domain";
import { expandCloze } from "@recall/application";
import {
  WorkspaceContentPushRequestSchema,
  WorkspaceContentPushResponseSchema,
  WorkspaceSnapshotSchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import { readWorkspaceSnapshotRows } from "@recall/infra-supabase";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import { writeWorkspaceContent } from "@recall/infra-supabase/workspace-write";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const StoredAreaSchema = Schema.Struct({
  id: Schema.String,
  color: Schema.String,
});
const StoredDeletedAreaSchema = Schema.Struct({ id: Schema.String });
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
        (card.kind === "basic" ||
          Either.isRight(
            Effect.runSync(Effect.either(expandCloze(card.text, card.deletionIndex))),
          )) &&
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
  return JSON.stringify(value);
}

function documentHash(document: typeof KnowledgeAreaSchema.Type): string {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const connected = await authenticateApiRequest(request);
  if (connected._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(connected.reason);
    return privateJson({ error: connected.reason }, { status });
  }
  const limited = await authenticatedApiRateLimit(connected.userId, "workspace-sync", { request });
  if (limited) return limited;

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 5_000_000)));
  if (
    Either.isLeft(body) ||
    typeof body.right !== "object" ||
    body.right === null ||
    !("areas" in body.right)
  ) {
    const tooLarge = Either.isLeft(body) && body.left.reason === "too-large";
    return privateJson(
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
    return privateJson({ error: "invalid-request" }, { status: 400 });
  }
  const contentRequest = Schema.decodeUnknownEither(WorkspaceContentPushRequestSchema)({
    ...body.right,
    tombstones: rawTombstones,
  });
  if (Either.isLeft(contentRequest))
    return privateJson({ error: "invalid-request" }, { status: 400 });
  const validatedRequest = contentRequest.right;
  const areas: Array<{
    document: typeof KnowledgeAreaSchema.Type;
    color: string;
    baseContentHash: string | null;
  }> = [];
  const areaIds = new Set<string>();
  const cardIds = new Set<string>();
  const objectiveIds = new Set<string>();
  let cardCount = 0;
  for (const rawArea of validatedRequest.areas) {
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
      return privateJson({ error: "invalid-content" }, { status: 400 });
    }
    if (areaIds.has(decoded.right.id))
      return privateJson({ error: "duplicate-area-id" }, { status: 400 });
    areaIds.add(decoded.right.id);
    for (const objective of decoded.right.objectives) {
      if (objectiveIds.has(objective.id))
        return privateJson({ error: "duplicate-objective-id" }, { status: 400 });
      objectiveIds.add(objective.id);
    }
    for (const card of decoded.right.cards) {
      if (cardIds.has(card.id)) return privateJson({ error: "duplicate-card-id" }, { status: 400 });
      cardIds.add(card.id);
    }
    cardCount += decoded.right.cards.length;
    if (cardCount > 2_000) return privateJson({ error: "batch-too-large" }, { status: 413 });
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
  const tombstones = validatedRequest.tombstones;
  const tombstoneKeys = tombstones.map(({ areaId, cardId }) => `${areaId}:${cardId}`);
  if (new Set(tombstoneKeys).size !== tombstones.length) {
    return privateJson({ error: "invalid-tombstones" }, { status: 400 });
  }
  const tombstoneSet = new Set(tombstones.map(({ cardId }) => cardId));
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
  const databasePayload = await Effect.runPromise(Effect.either(toDatabaseJson(filteredPayload)));
  if (Either.isLeft(databasePayload))
    return privateJson({ error: "invalid-content" }, { status: 400 });
  const databaseTombstones = await Effect.runPromise(Effect.either(toDatabaseJson(tombstones)));
  if (Either.isLeft(databaseTombstones))
    return privateJson({ error: "invalid-tombstones" }, { status: 400 });
  const saved = await Effect.runPromise(
    Effect.either(
      writeWorkspaceContent(
        connected.client,
        connected.userId,
        [...areaIds],
        databasePayload.right,
        databaseTombstones.right,
      ),
    ),
  );
  if (Either.isLeft(saved)) return privateJson({ error: "content-sync-failed" }, { status: 502 });
  if (saved.right._tag === "AreaDeleted")
    return privateJson({ error: "area-deleted-on-server" }, { status: 409 });
  if (saved.right._tag === "Conflict")
    return privateJson({ error: "content-conflict" }, { status: 409 });
  const result = Schema.decodeUnknownEither(WorkspaceContentPushResponseSchema)({
    schemaVersion: 1,
    syncedAreas: areas.length,
    syncedCards: cardCount,
  });
  if (Either.isLeft(result))
    return privateJson({ error: "workspace-response-invalid" }, { status: 502 });
  return privateJson(result.right);
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  const connected = await authenticateApiRequest(request);
  if (connected._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(connected.reason);
    return privateJson({ error: connected.reason }, { status });
  }
  const limited = await authenticatedApiRateLimit(connected.userId, "workspace-sync", { request });
  if (limited) return limited;

  const rows = await Effect.runPromise(Effect.either(readWorkspaceSnapshotRows(connected.client)));
  if (Either.isLeft(rows)) return privateJson({ error: "workspace-read-failed" }, { status: 502 });
  const deletedAreas = Schema.decodeUnknownEither(Schema.Array(StoredDeletedAreaSchema))(
    rows.right.deletedAreas,
  );
  if (Either.isLeft(deletedAreas))
    return privateJson({ error: "workspace-response-invalid" }, { status: 502 });
  const deletedAreaIds = deletedAreas.right.map((area) => area.id);
  const decodedAreas = Schema.decodeUnknownEither(Schema.Array(StoredAreaSchema))(rows.right.areas);
  if (Either.isLeft(decodedAreas))
    return privateJson({ error: "workspace-response-invalid" }, { status: 502 });
  if (decodedAreas.right.length === 0) {
    const snapshot = Schema.decodeUnknownEither(WorkspaceSnapshotSchema)({
      schemaVersion: 1,
      ownerId: connected.userId,
      areas: [],
      deletedAreaIds,
    });
    return Either.isLeft(snapshot)
      ? privateJson({ error: "workspace-response-invalid" }, { status: 502 })
      : privateJson(snapshot.right);
  }

  const versions = Schema.decodeUnknownEither(Schema.Array(StoredAreaVersionSchema))(
    rows.right.versions,
  );
  if (Either.isLeft(versions))
    return privateJson({ error: "workspace-response-invalid" }, { status: 502 });

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
      return privateJson({ error: "workspace-response-invalid" }, { status: 502 });
    const contentHash = latestVersionByArea.get(area.id)?.contentHash;
    if (!contentHash) return privateJson({ error: "workspace-response-invalid" }, { status: 502 });
    documents.push({ document: document.right, color: area.color, contentHash });
  }
  const snapshot = Schema.decodeUnknownEither(WorkspaceSnapshotSchema)({
    schemaVersion: 1,
    ownerId: connected.userId,
    areas: documents,
    deletedAreaIds,
  });
  return Either.isLeft(snapshot)
    ? privateJson({ error: "workspace-response-invalid" }, { status: 502 })
    : privateJson(snapshot.right);
}

export const GET = observeRoute("workspace-read", handleGET);

export const POST = observeRoute("workspace-write", handlePOST);
