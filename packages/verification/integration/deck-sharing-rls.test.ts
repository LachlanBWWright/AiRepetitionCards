import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeckSharingRlsCleanup } from "./deck-sharing-rls-cleanup";
import { verifyDeckSharingPublicPublication } from "./deck-sharing-rls-publication";
import { verifyDeckSharingLinkAndModeration } from "./deck-sharing-rls-sharing";
import { verifyDeckSharingSubscriptions } from "./deck-sharing-rls-subscriptions";
import { Effect, Either } from "effect";
import {
  createDeckSharingRlsFixtures,
  deckSharingFixtureId,
  deckSharingFixtureSha256,
} from "./deck-sharing-rls-fixtures";
import {
  configuration,
  denied,
  request,
  verify,
  type Configuration,
  type Identity,
  type IntegrationFailure,
  type Reply,
} from "./supabase-http";

const id = deckSharingFixtureId;
const sha256 = deckSharingFixtureSha256;
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
  const areaIds: string[] = [];
  const publicationIds: string[] = [];
  const reportIds: string[] = [];
  const runId = id();
  const fixtures = createDeckSharingRlsFixtures(config, admin, anon, runId, createdUsers);

  function rpc(identity: Identity, name: string, body: unknown) {
    return request(config, identity, `/rest/v1/rpc/${name}`, { method: "POST", body });
  }
  function expectDenied(effect: Effect.Effect<Reply, IntegrationFailure>, label: string) {
    return effect.pipe(
      Effect.flatMap((reply) =>
        verify(
          denied(reply),
          `${label}: unauthorized request was not denied (${String(reply.status)}).`,
        ),
      ),
    );
  }
  const execute = Effect.gen(function* () {
    const owner = yield* fixtures.makeUser("owner");
    const viewer = yield* fixtures.makeUser("viewer");
    const stranger = yield* fixtures.makeUser("stranger");
    const sourceAreaId = id();
    const sourceDocument = yield* fixtures.areaDocument(sourceAreaId, "Deck sharing source");
    areaIds.push(sourceAreaId);
    yield* fixtures.provisionArea(owner, sourceAreaId, sourceDocument);

    const publicVersionId = id();
    const scenarioContext = {
      config,
      admin,
      anon,
      owner,
      viewer,
      stranger,
      sourceAreaId,
      sourceDocument,
      publicVersionId,
      fixtures,
      rpc,
      expectDenied,
      id,
      areaIds,
      publicationIds,
      reportIds,
    } as const;
    yield* verifyDeckSharingPublicPublication(scenarioContext);
    const versions = yield* verifyDeckSharingSubscriptions(scenarioContext);
    yield* verifyDeckSharingLinkAndModeration(scenarioContext, versions, runId, sha256);
  });

  const cleanup = createDeckSharingRlsCleanup({
    config,
    admin,
    createdUsers,
    areaIds,
    publicationIds,
    reportIds,
  });

  return Effect.gen(function* () {
    const result = yield* Effect.either(execute);
    const cleaned = yield* Effect.either(cleanup);
    if (Either.isLeft(cleaned)) return yield* Effect.fail(cleaned.left);
    if (Either.isLeft(result)) return yield* Effect.fail(result.left);
  });
}

void test("local Supabase public/link sharing, updates, moderation, feedback, and withdrawal RLS", async () => {
  const result = await Effect.runPromise(
    Effect.either(configuration().pipe(Effect.flatMap(suite))),
  );
  assert.ok(Either.isRight(result), Either.isLeft(result) ? result.left.message : undefined);
});
