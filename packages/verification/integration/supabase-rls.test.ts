import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";
import { publicationContentHash } from "@recall/application";
import {
  configuration,
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

const UserSchema = Schema.Struct({ id: Schema.UUID });
const SessionSchema = Schema.Struct({
  access_token: Schema.String.pipe(Schema.minLength(1)),
  user: UserSchema,
});
const id = () => randomUUID();
const mediaBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const mediaId = createHash("sha256").update(mediaBytes).digest("hex");
const otherBytes = new Uint8Array([...mediaBytes, 0]);
const otherMediaId = createHash("sha256").update(otherBytes).digest("hex");

function suite(config: Configuration) {
  const admin: Identity = {
    key: config.serviceRoleKey,
    token: config.serviceRoleKey.startsWith("sb_secret_") ? null : config.serviceRoleKey,
  };
  const anon: Identity = {
    key: config.publishableKey,
    token: config.publishableKey.startsWith("sb_publishable_") ? null : config.publishableKey,
  };
  const createdUsers: string[] = [];
  const publications: string[] = [];
  const uploadedPaths = new Set<string>();
  const runId = id();
  function makeUser(label: string) {
    return Effect.gen(function* () {
      const email = `recall-rls-${runId}-${label}@example.invalid`;
      const password = `${id()}-${id()}`;
      const created = yield* request(config, admin, "/auth/v1/admin/users", {
        method: "POST",
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { recall_integration_run: runId },
        },
      });
      yield* successful(created, "Create isolated Auth fixture");
      const user = yield* Schema.decodeUnknown(UserSchema)(created.body).pipe(
        Effect.mapError(() => failure("Auth fixture identity was invalid.")),
      );
      createdUsers.push(user.id);
      const signedIn = yield* request(config, anon, "/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
      });
      yield* successful(signedIn, "Sign in isolated fixture");
      const session = yield* Schema.decodeUnknown(SessionSchema)(signedIn.body).pipe(
        Effect.mapError(() => failure("Auth fixture session was invalid.")),
      );
      yield* verify(session.user.id === user.id, "Auth fixture session changed identity.");
      return { userId: user.id, key: config.publishableKey, token: session.access_token };
    });
  }
  function insert(identity: Identity, table: string, body: unknown) {
    return request(config, identity, `/rest/v1/${table}`, { method: "POST", body });
  }
  function rpc(identity: Identity, name: string, body: unknown) {
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
  const execute = Effect.gen(function* () {
    const owner = yield* makeUser("owner");
    const stranger = yield* makeUser("stranger");
    const areaId = id();
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
    const provision = yield* rpc(owner, "sync_workspace_content", {
      p_areas: [envelope],
      p_tombstones: [],
    });
    yield* successful(provision, "Owner transactional content provisioning");
    yield* verify(provision.body === true, "Owner content provisioning was rejected.");
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
      yield* successful(yield* insert(owner, table, body), `Owner insert ${table}`);
      const fields = yield* Schema.decodeUnknown(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      )(body).pipe(Effect.mapError(() => failure("Integration row fixture was invalid.")));
      const spoof = { ...fields, ...("id" in fields ? { id: id() } : {}) };
      yield* expectDenied(
        insert(stranger, table, spoof),
        `Stranger cannot insert ${table} as owner`,
      );
      yield* expectDenied(insert(anon, table, spoof), `Anonymous cannot insert ${table}`);
    }
    const reserve = yield* rpc(owner, "reserve_tutor_ai_call", {
      p_id: usageId,
      p_operation: "question",
      p_model: "fixture",
    });
    yield* successful(reserve, "Owner quota reservation");
    yield* verify(reserve.body === true, "Owner quota reservation failed.");
    const privateTables: readonly [string, string][] = [
      ["profiles", `user_id=eq.${owner.userId}`],
      ["knowledge_areas", `id=eq.${areaId}`],
      ["knowledge_area_versions", `knowledge_area_id=eq.${areaId}`],
      ["learning_objectives", `knowledge_area_id=eq.${areaId}`],
      ["objective_prerequisites", `knowledge_area_id=eq.${areaId}`],
      ["cards", `knowledge_area_id=eq.${areaId}`],
      ["card_revisions", `card_id=eq.${cardId}`],
      ["card_objectives", `knowledge_area_id=eq.${areaId}`],
      ["review_events", `user_id=eq.${owner.userId}`],
      ["scheduling_state", `user_id=eq.${owner.userId}`],
      ["sync_changes", `user_id=eq.${owner.userId}`],
      ["tutor_sessions", `user_id=eq.${owner.userId}`],
      ["tutor_messages", `user_id=eq.${owner.userId}`],
      ["ai_observations", `user_id=eq.${owner.userId}`],
      ["generated_card_proposals", `user_id=eq.${owner.userId}`],
      ["tutor_ai_usage_events", `user_id=eq.${owner.userId}`],
    ];
    for (const [table, query] of privateTables) {
      const path = `/rest/v1/${table}?select=*&${query}`;
      const owned = yield* rows(yield* request(config, owner, path), `Owner read ${table}`);
      yield* verify(
        owned.length > 0,
        `Owner cannot read seeded ${table}; empty fixtures cannot prove isolation.`,
      );
      for (const [label, identity] of [
        ["anon", anon],
        ["stranger", stranger],
      ] as const)
        yield* expectDenied(request(config, identity, path), `${label} read ${table}`);
    }
    yield* expectDenied(
      insert(stranger, "knowledge_areas", {
        id: id(),
        owner_id: owner.userId,
        title: "Intrusion",
        color: "#123456",
      }),
      "Spoof area owner",
    );
    yield* expectDenied(
      insert(stranger, "learning_objectives", {
        id: id(),
        knowledge_area_id: areaId,
        title: "Intrusion",
      }),
      "Attach foreign objective",
    );
    for (const [table, body] of [
      [
        "knowledge_area_versions",
        {
          id: id(),
          knowledge_area_id: areaId,
          version: 2,
          content: document,
          content_hash: contentHash,
          created_by: stranger.userId,
        },
      ],
      [
        "card_revisions",
        {
          id: id(),
          card_id: cardId,
          revision: 2,
          content: {},
          provenance: "intrusion",
          creator_type: "learner",
          created_by: stranger.userId,
        },
      ],
      [
        "card_objectives",
        { knowledge_area_id: areaId, card_id: cardId, objective_id: prerequisiteId },
      ],
      [
        "objective_prerequisites",
        { knowledge_area_id: areaId, objective_id: prerequisiteId, prerequisite_id: objectiveId },
      ],
    ] as const)
      yield* expectDenied(
        insert(stranger, table, body),
        `Stranger cannot attach ${table} to owner content`,
      );
    const protectedReview = {
      id: id(),
      user_id: stranger.userId,
      card_id: cardId,
      device_id: id(),
      device_sequence: 1,
      reviewed_at_device: "2026-10-04T00:00:00Z",
      effective_reviewed_at: "2026-10-04T00:00:00Z",
      rating: "good",
      scheduler_family: "fsrs",
      scheduler_version: "fixture",
    };
    yield* expectDenied(
      insert(stranger, "review_events", protectedReview),
      "Review another owner's card",
    );
    for (const table of ["review_events", "card_revisions", "knowledge_area_versions"])
      for (const method of ["PATCH", "DELETE"] as const)
        yield* expectDenied(
          request(
            config,
            owner,
            `/rest/v1/${table}?${table === "review_events" ? `id=eq.${reviewId}` : table === "card_revisions" ? `card_id=eq.${cardId}` : `knowledge_area_id=eq.${areaId}`}`,
            {
              method,
              ...(method === "PATCH"
                ? { body: table === "review_events" ? { rating: "again" } : { content: {} } }
                : {}),
            },
          ),
          `${table} immutable ${method}`,
        );
    const takeover = yield* rpc(stranger, "sync_workspace_content", {
      p_areas: [envelope],
      p_tombstones: [],
    });
    yield* successful(takeover, "Foreign sync rejection");
    yield* verify(
      takeover.body === false,
      "Foreign sync silently adopted another owner's content.",
    );

    yield* expectDenied(
      rpc(anon, "sync_workspace_content", { p_areas: [envelope], p_tombstones: [] }),
      "Anonymous content provisioning",
    );
    yield* expectDenied(
      rpc(owner, "erase_account_data", { p_user_id: stranger.userId }),
      "Client invocation of service-only account erasure",
    );
    const uploadPath = `${owner.userId}/${mediaId}`;
    uploadedPaths.add(uploadPath);
    yield* successful(
      yield* request(config, owner, `/storage/v1/object/published-media/${uploadPath}`, {
        method: "POST",
        bytes: mediaBytes,
        headers: { "content-type": "image/png", "x-upsert": "false" },
      }),
      "Owner Storage upload",
    );
    const unreferencedPath = `${owner.userId}/${otherMediaId}`;
    uploadedPaths.add(unreferencedPath);
    yield* successful(
      yield* request(config, owner, `/storage/v1/object/published-media/${unreferencedPath}`, {
        method: "POST",
        bytes: otherBytes,
        headers: { "content-type": "image/png" },
      }),
      "Owner unreferenced Storage upload",
    );
    const download = (identity: Identity, path: string, version?: string, hash?: string) =>
      request(config, identity, `/storage/v1/object/authenticated/published-media/${path}`, {
        headers: {
          ...(version ? { "x-recall-publication-version-id": version } : {}),
          ...(hash ? { "x-recall-share-token-hash": hash } : {}),
        },
      });
    const ownerMedia = yield* download(owner, uploadPath);
    yield* successful(ownerMedia, "Owner private Storage read");
    yield* verify(
      Buffer.from(ownerMedia.bytes).equals(Buffer.from(mediaBytes)),
      "Owner Storage bytes changed.",
    );
    for (const identity of [anon, stranger])
      yield* expectDenied(download(identity, uploadPath), "Unpublished Storage read");
    const strangerPath = `${stranger.userId}/${mediaId}`;
    uploadedPaths.add(strangerPath);
    yield* successful(
      yield* request(config, stranger, `/storage/v1/object/published-media/${strangerPath}`, {
        method: "POST",
        bytes: mediaBytes,
        headers: { "content-type": "image/png" },
      }),
      "Stranger can upload in own namespace",
    );
    yield* expectDenied(download(owner, strangerPath), "Owner cannot read stranger private media");
    const foreignBytes = new Uint8Array([...mediaBytes, 1]);
    const foreignHash = createHash("sha256").update(foreignBytes).digest("hex");
    const foreignPath = `${owner.userId}/${foreignHash}`;
    uploadedPaths.add(foreignPath);
    yield* expectDenied(
      request(config, stranger, `/storage/v1/object/published-media/${foreignPath}`, {
        method: "POST",
        bytes: foreignBytes,
        headers: { "content-type": "image/png" },
      }),
      "Stranger cannot upload in owner's namespace",
    );
    const tokenHash = createHash("sha256").update(id()).digest("hex");
    const wrongHash = createHash("sha256").update(id()).digest("hex");
    const versions = { private: id(), unlisted: id(), public: id() };
    let number = 0;
    for (const visibility of ["private", "unlisted", "public"] as const) {
      const publicationId = versions[visibility];
      publications.push(publicationId);
      number += 1;
      yield* successful(
        yield* insert(owner, "published_knowledge_area_versions", {
          id: publicationId,
          source_area_id: areaId,
          owner_id: owner.userId,
          created_by: owner.userId,
          version: number,
          content: document,
          content_hash: contentHash,
          visibility,
          ...(visibility === "unlisted" ? { share_token_hash: tokenHash } : {}),
        }),
        "Owner immutable publication insert",
      );
      for (const identity of [owner, anon, stranger]) {
        const reply = yield* request(
          config,
          identity,
          `/rest/v1/published_knowledge_area_versions?select=id,content,visibility&id=eq.${publicationId}`,
        );
        if (identity === owner || visibility === "public")
          yield* verify(
            (yield* rows(reply, "Publication readable")).length === 1,
            "Readable publication was hidden.",
          );
        else yield* verify(denied(reply), "Private/unlisted publication leaked through SELECT.");
      }
      yield* expectDenied(
        request(
          config,
          owner,
          `/rest/v1/published_knowledge_area_versions?select=share_token_hash&id=eq.${publicationId}`,
        ),
        "Publication token digest SELECT",
      );
      yield* expectDenied(
        request(
          config,
          owner,
          `/rest/v1/published_knowledge_area_versions?id=eq.${publicationId}`,
          { method: "PATCH", body: { content: {} } },
        ),
        "Publication immutable content",
      );
    }
    for (const identity of [anon, stranger]) {
      for (const [hash, expected] of [
        [wrongHash, 0],
        [tokenHash, 1],
      ] as const) {
        const result = yield* rpc(identity, "read_unlisted_knowledge_area_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: hash,
        });
        yield* verify(
          (yield* rows(result, "Unlisted capability read")).length === expected,
          "Unlisted capability isolation failed.",
        );
      }
      yield* expectDenied(
        download(identity, uploadPath, versions.private, tokenHash),
        "Private publication Storage read",
      );
      yield* expectDenied(
        download(identity, uploadPath, versions.unlisted, wrongHash),
        "Wrong unlisted Storage capability",
      );
      yield* successful(
        yield* download(identity, uploadPath, versions.unlisted, tokenHash),
        "Valid unlisted Storage capability",
      );
      yield* successful(
        yield* download(identity, uploadPath, versions.public),
        "Public referenced Storage read",
      );
      yield* expectDenied(
        download(identity, unreferencedPath, versions.public),
        "Unreferenced Storage read",
      );
    }
    const forbiddenRotation = yield* rpc(stranger, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "revoke",
      p_share_token_hash: null,
    });
    yield* successful(forbiddenRotation, "Foreign token management rejection");
    yield* verify(
      forbiddenRotation.body === false,
      "Stranger revoked another owner's share capability.",
    );
    const rotated = yield* rpc(owner, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "rotate",
      p_share_token_hash: wrongHash,
    });
    yield* successful(rotated, "Owner token rotation");
    yield* verify(rotated.body === true, "Owner token rotation failed.");
    yield* verify(
      (yield* rows(
        yield* rpc(anon, "read_unlisted_knowledge_area_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: tokenHash,
        }),
        "Old token revoked",
      )).length === 0,
      "Rotated token still reads content.",
    );
    yield* expectDenied(
      download(anon, uploadPath, versions.unlisted, tokenHash),
      "Rotated token still reads media",
    );
    const revoked = yield* rpc(owner, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "revoke",
      p_share_token_hash: null,
    });
    yield* successful(revoked, "Owner token revocation");
    yield* verify(revoked.body === true, "Owner token revocation failed.");
    yield* verify(
      (yield* rows(
        yield* rpc(anon, "read_unlisted_knowledge_area_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: wrongHash,
        }),
        "Revoked capability read",
      )).length === 0,
      "Revoked token still reads content.",
    );
    yield* expectDenied(
      download(anon, uploadPath, versions.unlisted, wrongHash),
      "Revoked token still reads media",
    );
    const deletion = yield* request(config, stranger, "/storage/v1/object/published-media", {
      method: "DELETE",
      body: { prefixes: [uploadPath] },
    });
    yield* verify(denied(deletion), "Stranger Storage deletion was accepted.");
    yield* successful(
      yield* download(owner, uploadPath),
      "Foreign Storage deletion preserved owner data",
    );
  });

  const cleanup = Effect.gen(function* () {
    const results = [];
    if (uploadedPaths.size > 0)
      results.push(
        yield* Effect.either(
          request(config, admin, "/storage/v1/object/published-media", {
            method: "DELETE",
            body: { prefixes: [...uploadedPaths] },
          }).pipe(Effect.flatMap((reply) => successful(reply, "Scoped Storage fixture cleanup"))),
        ),
      );
    for (const publicationId of publications)
      results.push(
        yield* Effect.either(
          request(
            config,
            admin,
            `/rest/v1/published_knowledge_area_versions?id=eq.${publicationId}`,
            { method: "DELETE" },
          ).pipe(
            Effect.flatMap((reply) => successful(reply, "Scoped publication fixture cleanup")),
          ),
        ),
      );
    for (const userId of createdUsers) {
      results.push(
        yield* Effect.either(
          rpc(admin, "erase_account_data", { p_user_id: userId }).pipe(
            Effect.flatMap((reply) =>
              successful(reply, "Scoped learning fixture cleanup").pipe(
                Effect.flatMap(() =>
                  verify(reply.body === true, "Learning fixture erasure was rejected."),
                ),
              ),
            ),
            Effect.flatMap(() =>
              request(config, admin, `/auth/v1/admin/users/${userId}`, { method: "DELETE" }),
            ),
            Effect.flatMap((reply) => successful(reply, "Scoped Auth fixture cleanup")),
          ),
        ),
      );
    }
    yield* verify(
      results.every(Either.isRight),
      `Integration fixture cleanup was incomplete for run ${runId}; inspect fixture user IDs ${createdUsers.join(", ")} before retrying.`,
    );
  });
  return Effect.gen(function* () {
    const result = yield* Effect.either(execute);
    const cleaned = yield* Effect.either(cleanup);
    if (Either.isLeft(cleaned)) return yield* Effect.fail(cleaned.left);
    if (Either.isLeft(result)) return yield* Effect.fail(result.left);
  });
}

await test("real local Supabase owner/stranger/anon RLS and private/public/unlisted Storage isolation", async () => {
  const result = await Effect.runPromise(
    Effect.either(configuration().pipe(Effect.flatMap(suite))),
  );
  assert.ok(Either.isRight(result), Either.isLeft(result) ? result.left.message : undefined);
});
