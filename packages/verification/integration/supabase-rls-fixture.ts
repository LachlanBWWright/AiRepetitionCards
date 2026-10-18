import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";
import { publicationContentHash } from "@recall/application";
import {
  request,
  successful,
  verify,
  rows,
  denied,
  failure,
  type Configuration,
  type Identity,
  type IntegrationFailure,
  type Reply,
} from "./supabase-http";

type UserIdentity = Identity & { readonly userId: string };
type FixtureOptions = {
  readonly config: Configuration;
  readonly owner: UserIdentity;
  readonly stranger: UserIdentity;
  readonly anon: Identity;
  readonly mediaBytes: Uint8Array;
  readonly mediaId: string;
  readonly registerArea: (areaId: string) => void;
};

function insert(config: Configuration, identity: Identity, table: string, body: unknown) {
  return request(config, identity, `/rest/v1/${table}`, { method: "POST", body });
}

function rpc(config: Configuration, identity: Identity, name: string, body: unknown) {
  return request(config, identity, `/rest/v1/rpc/${name}`, { method: "POST", body });
}

function expectDenied(effect: Effect.Effect<Reply, IntegrationFailure>, label: string) {
  return effect.pipe(
    Effect.flatMap((reply) =>
      verify(
        denied(reply),
        `${label}: unauthorized access succeeded or failed unexpectedly (${String(reply.status)}).`,
      ),
    ),
  );
}

export function provisionRlsFixture(options: FixtureOptions) {
  const { config, owner, stranger, anon, mediaBytes, mediaId, registerArea } = options;
  const id = () => randomUUID();
  return Effect.gen(function* () {
    const areaId = id();
    registerArea(areaId);
    const cardId = id();
    const objectiveId = id();
    const prerequisiteId = id();
    const versionId = id();
    const revisionId = id();
    const reviewId = id();
    const sessionId = id();
    const observationId = id();
    const proposalId = id();
    const usageId = id();
    const document = yield* Schema.decodeUnknown(KnowledgeAreaSchema)({
      schemaVersion: "1.0.0",
      id: areaId,
      title: "RLS fixture",
      description: null,
      language: "en",
      objectives: [
        {
          id: objectiveId,
          title: "Objective",
          description: null,
          prerequisiteIds: [prerequisiteId],
        },
        { id: prerequisiteId, title: "Prerequisite", description: null, prerequisiteIds: [] },
      ],
      ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
      cards: [
        {
          kind: "basic",
          id: cardId,
          front: "Question",
          back: "Answer",
          objectiveIds: [objectiveId],
          tags: [],
          origin: "authored",
          provenance: { externalId: null, source: "authored", sourceVersion: null },
          media: [{ id: mediaId, mimeType: "image/png", byteLength: mediaBytes.byteLength }],
        },
      ],
      tags: [],
      licence: null,
    }).pipe(Effect.mapError(() => failure("Canonical integration document was invalid.")));
    const contentHash = publicationContentHash(document);
    const envelope = {
      id: areaId,
      title: document.title,
      language: "en",
      color: "#123456",
      tags: [],
      document,
      contentHash,
      baseContentHash: null,
      versionId,
      objectives: document.objectives,
      cards: document.cards.map((card) => ({ ...card, revisionId })),
    };
    const provision = yield* rpc(config, owner, "sync_workspace_content", {
      p_areas: [envelope],
      p_tombstones: [],
    });
    yield* successful(provision, "Owner transactional content provisioning");
    yield* verify(provision.body === true, "Owner content provisioning was rejected.");
    const unchangedSync = yield* rpc(config, owner, "sync_workspace_content", {
      p_areas: [envelope],
      p_tombstones: [],
    });
    yield* successful(unchangedSync, "Unchanged workspace content replay");
    yield* verify(unchangedSync.body === true, "Unchanged workspace content replay was rejected.");
    const areaVersions = yield* rows(
      yield* request(
        config,
        owner,
        `/rest/v1/knowledge_area_versions?select=id&knowledge_area_id=eq.${areaId}`,
      ),
      "Workspace content version replay",
    );
    yield* verify(
      areaVersions.length === 1,
      "Unchanged workspace replay created a duplicate area version.",
    );
    const seedRows: readonly [string, unknown][] = [
      ["profiles", { user_id: owner.userId, display_name: "Fixture owner" }],
      [
        "review_events",
        {
          id: reviewId,
          user_id: owner.userId,
          card_id: cardId,
          device_id: id(),
          device_sequence: 1,
          reviewed_at_device: "2026-10-04T00:00:00Z",
          effective_reviewed_at: "2026-10-04T00:00:00Z",
          rating: "good",
          scheduler_family: "fsrs",
          scheduler_version: "ts-fsrs@5.4.2",
        },
      ],
      [
        "scheduling_state",
        {
          user_id: owner.userId,
          card_id: cardId,
          scheduler_family: "fsrs",
          scheduler_version: "ts-fsrs@5.4.2",
          last_review_event_id: reviewId,
          state: {},
        },
      ],
      [
        "tutor_sessions",
        {
          id: sessionId,
          user_id: owner.userId,
          area_id: areaId,
          area_title: document.title,
          area_snapshot: document,
        },
      ],
      [
        "tutor_messages",
        {
          id: id(),
          session_id: sessionId,
          user_id: owner.userId,
          role: "learner",
          kind: "question",
          content: { text: "Question" },
        },
      ],
      [
        "ai_observations",
        {
          id: observationId,
          session_id: sessionId,
          user_id: owner.userId,
          objective_id: objectiveId,
          result: "partial",
          confidence: 0.8,
          evidence_summary: "Fixture",
          suggested_action: "propose-card",
          payload: {},
        },
      ],
      [
        "generated_card_proposals",
        {
          id: proposalId,
          session_id: sessionId,
          observation_id: observationId,
          user_id: owner.userId,
          content: {},
        },
      ],
    ];
    for (const [table, body] of seedRows) {
      yield* successful(yield* insert(config, owner, table, body), `Owner insert ${table}`);
      const fields = yield* Schema.decodeUnknown(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      )(body).pipe(Effect.mapError(() => failure("Integration row fixture was invalid.")));
      const spoof = { ...fields, ...("id" in fields ? { id: id() } : {}) };
      yield* expectDenied(
        insert(config, stranger, table, spoof),
        `Stranger cannot insert ${table} as owner`,
      );
      yield* expectDenied(insert(config, anon, table, spoof), `Anonymous cannot insert ${table}`);
    }
    const reserve = yield* rpc(config, owner, "reserve_tutor_ai_call", {
      p_id: usageId,
      p_operation: "question",
      p_model: "fixture",
    });
    yield* successful(reserve, "Owner quota reservation");
    yield* verify(reserve.body === true, "Owner quota reservation failed.");
    return {
      areaId,
      cardId,
      objectiveId,
      prerequisiteId,
      reviewId,
      document,
      contentHash,
      envelope,
    };
  });
}
