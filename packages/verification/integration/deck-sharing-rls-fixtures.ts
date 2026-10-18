import { createHash, randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { publicationContentHash } from "@recall/application";
import { KnowledgeAreaSchema } from "@recall/domain";
import {
  failure,
  request,
  rows,
  successful,
  verify,
  type Configuration,
  type Identity,
} from "./supabase-http";

export const deckSharingFixtureId = () => randomUUID();
export const deckSharingFixtureSha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const deckSharingFixtureMediaId = "a".repeat(64);

const UserSchema = Schema.Struct({ id: Schema.UUID });
const SessionSchema = Schema.Struct({
  access_token: Schema.String.pipe(Schema.minLength(1)),
  user: UserSchema,
});

export function createDeckSharingRlsFixtures(
  config: Configuration,
  admin: Identity,
  anon: Identity,
  runId: string,
  createdUsers: string[],
) {
  function rpc(identity: Identity, name: string, body: unknown) {
    return request(config, identity, `/rest/v1/rpc/${name}`, { method: "POST", body });
  }
  function makeUser(label: string) {
    return Effect.gen(function* () {
      const email = `recall-deck-${runId}-${label}@example.com`;
      const password = `${deckSharingFixtureId()}-aA1!`;
      const created = yield* request(config, admin, "/auth/v1/admin/users", {
        method: "POST",
        body: { email, password, email_confirm: true, user_metadata: { recall_deck_run: runId } },
      });
      yield* successful(created, "Create deck-sharing Auth fixture");
      const user = yield* Schema.decodeUnknown(UserSchema)(created.body).pipe(
        Effect.mapError(() => failure("Deck-sharing Auth identity was invalid.")),
      );
      createdUsers.push(user.id);
      const signedIn = yield* request(config, anon, "/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
      });
      yield* successful(signedIn, "Sign in deck-sharing fixture");
      const session = yield* Schema.decodeUnknown(SessionSchema)(signedIn.body).pipe(
        Effect.mapError(() => failure("Deck-sharing Auth session was invalid.")),
      );
      yield* verify(session.user.id === user.id, "Deck-sharing session changed identity.");
      return { userId: user.id, key: config.publishableKey, token: session.access_token };
    });
  }
  function areaDocument(areaId: string, title: string, lineage?: string) {
    return Schema.decodeUnknown(KnowledgeAreaSchema)({
      schemaVersion: "1.0.0",
      id: areaId,
      title,
      description: null,
      language: "en",
      ...(lineage === undefined ? {} : { forkedFromVersionId: lineage }),
      objectives: [],
      ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
      cards: [
        {
          kind: "basic",
          id: deckSharingFixtureId(),
          front: "Question",
          back: "Answer",
          objectiveIds: [],
          tags: [],
          origin: "authored",
          provenance: { externalId: null, source: "authored", sourceVersion: null },
          media: [{ id: deckSharingFixtureMediaId, mimeType: "image/png", byteLength: 1 }],
        },
      ],
      tags: [],
      licence: "CC-BY-4.0",
    }).pipe(Effect.mapError(() => failure("Deck-sharing area content was invalid.")));
  }
  function provisionArea(
    identity: Identity,
    areaId: string,
    document: Schema.Schema.Type<typeof KnowledgeAreaSchema>,
  ) {
    return Effect.gen(function* () {
      const versionId = deckSharingFixtureId();
      const revisionId = deckSharingFixtureId();
      const envelope = {
        id: areaId,
        title: document.title,
        language: document.language,
        color: "#123456",
        tags: [],
        document,
        contentHash: publicationContentHash(document),
        baseContentHash: null,
        versionId,
        objectives: document.objectives,
        cards: document.cards.map((card) => ({ ...card, revisionId })),
      };
      const synced = yield* rpc(identity, "sync_workspace_content", {
        p_areas: [envelope],
        p_tombstones: [],
      });
      yield* successful(synced, "Provision deck-sharing area through workspace sync");
      yield* verify(synced.body === true, "Workspace sync did not persist the deck-sharing area.");
    });
  }
  function publication(
    ownerId: string,
    areaId: string,
    document: Schema.Schema.Type<typeof KnowledgeAreaSchema>,
    visibility: "public" | "private" | "unlisted",
    versionId: string,
    tokenHash: string | null,
    operationId = deckSharingFixtureId(),
  ) {
    return {
      p_version_id: versionId,
      p_source_area_id: areaId,
      p_owner_id: ownerId,
      p_operation_id: operationId,
      p_content: document,
      p_content_hash: publicationContentHash(document),
      p_visibility: visibility,
      p_attribution: null,
      p_license: "CC-BY-4.0",
      p_forked_from_version_id: null,
      p_share_token_hash: tokenHash,
    };
  }
  function createPublication(args: ReturnType<typeof publication>) {
    return Effect.gen(function* () {
      const result = yield* rpc(admin, "create_deck_publication", args);
      const safeError =
        typeof result.body === "object" && result.body !== null
          ? `${"code" in result.body && typeof result.body.code === "string" ? result.body.code : "error"}: ${"message" in result.body && typeof result.body.message === "string" ? result.body.message : "unknown"}`
          : "unknown response";
      yield* verify(
        result.status >= 200 && result.status < 300,
        `Service publication registration: unexpected HTTP ${String(result.status)} (${safeError}).`,
      );
      const saved = yield* rows(result, "Service publication registration result");
      yield* verify(
        saved.length === 1,
        "Service publication RPC did not return exactly one version.",
      );
      return saved[0];
    });
  }

  return { makeUser, areaDocument, provisionArea, publication, createPublication };
}
