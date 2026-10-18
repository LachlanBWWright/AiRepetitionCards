import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { provisionRlsFixture } from "./supabase-rls-fixture";
import { runPublicationChecks } from "./supabase-rls-publication-checks";
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
  const areaIds: string[] = [];
  const uploadedPaths = new Set<string>();
  const runId = id();
  function makeUser(label: string) {
    return Effect.gen(function* () {
      const email = `recall-rls-${runId}-${label}@example.com`;
      const password = `${id()}-aA1!`;
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
    const fixture = yield* provisionRlsFixture({
      config,
      owner,
      stranger,
      anon,
      mediaBytes,
      mediaId,
      registerArea: (areaId) => areaIds.push(areaId),
    });
    const {
      areaId,
      cardId,
      objectiveId,
      prerequisiteId,
      reviewId,
      document,
      contentHash,
      envelope,
    } = fixture;
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
    const uploadPath = yield* runPublicationChecks({
      config,
      admin,
      anon,
      owner,
      stranger,
      areaId,
      mediaBytes,
      otherBytes,
      mediaId,
      otherMediaId,
      document,
      contentHash,
      id,
      uploadedPaths,
      publications,
      rpc,
      expectDenied,
    });
    const deletion = yield* request(config, stranger, "/storage/v1/object/published-media", {
      method: "DELETE",
      body: { prefixes: [uploadPath] },
    });
    yield* verify(denied(deletion), "Stranger Storage deletion was accepted.");
    yield* successful(
      yield* request(
        config,
        owner,
        `/storage/v1/object/authenticated/published-media/${uploadPath}`,
      ),
      "Foreign Storage deletion preserved owner data",
    );
  });

  const cleanupUser = (userId: string) =>
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
    );

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
    for (const areaId of areaIds)
      results.push(
        yield* Effect.either(
          request(config, admin, `/rest/v1/shared_decks?deck_id=eq.${areaId}`, {
            method: "DELETE",
          }).pipe(
            Effect.flatMap((reply) => successful(reply, "Scoped deck registry fixture cleanup")),
          ),
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
    for (const userId of createdUsers) results.push(yield* Effect.either(cleanupUser(userId)));
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
