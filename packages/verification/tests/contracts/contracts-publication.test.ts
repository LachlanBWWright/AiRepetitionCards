import test from "node:test";
import {
  assert,
  Effect,
  Either,
  createPublicationFork,
  createPublishingApi,
  preparePublication,
  publicationContentHash,
  KnowledgeAreaSchema,
  first,
  second,
  third,
  token,
  timestamp,
  document,
  version,
  valid,
} from "./contracts-test-support.js";

void test("publishing client rejects unrequested identities and incorrect token outcomes", async () => {
  const response = (body: unknown) =>
    createPublishingApi(() => Effect.succeed({ status: 200, body }));
  assert.ok(
    Either.isRight(
      await Effect.runPromise(Effect.either(response({ schemaVersion: 1, version }).read(second))),
    ),
  );
  for (const operation of [
    response({ version: { ...version, id: third } })
      .read(second)
      .pipe(Effect.asVoid),
    response({ versionId: third, token }).manageShareToken(second, "rotate").pipe(Effect.asVoid),
    response({ versionId: second, token: null })
      .manageShareToken(second, "rotate")
      .pipe(Effect.asVoid),
    response({ versionId: second, token }).manageShareToken(second, "revoke").pipe(Effect.asVoid),
  ]) {
    const result = await Effect.runPromise(Effect.either(operation));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});
void test("publication rights and fork provenance require explicit coherent intent", () => {
  const request = {
    operationId: third,
    sourceAreaId: first,
    content: document,
    visibility: "public",
  };
  const prepared = Effect.runSync(Effect.either(preparePublication(request)));
  assert.ok(Either.isRight(prepared));
  assert.equal(prepared.right.forkedFromVersionId, null);
  assert.equal("forkedFromVersionId" in prepared.right.content, false);
  for (const input of [
    { ...request, content: { ...document, licence: null } },
    {
      ...request,
      content: { ...document, forkedFromVersionId: second },
      forkedFromVersionId: third,
    },
    { ...request, content: { ...document, sourceId: "imported-source" } },
    { ...request, visibility: "unlisted" },
    { ...request, shareToken: token },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(preparePublication(input)))));
  assert.ok(
    Either.isRight(
      Effect.runSync(
        Effect.either(
          preparePublication({
            ...request,
            content: { ...document, sourceId: "imported-source" },
            reuseConfirmed: true,
          }),
        ),
      ),
    ),
  );
});

void test("fork and publication update clients reject mismatched request lineage and identities", async () => {
  const api = (body: unknown) => createPublishingApi(() => Effect.succeed({ status: 200, body }));
  const fork = {
    schemaVersion: 1,
    operationId: third,
    saved: true,
    areaId: first,
    contentHash: publicationContentHash(
      valid(KnowledgeAreaSchema, { ...document, forkedFromVersionId: second }),
    ),
    document: { ...document, forkedFromVersionId: second },
    attribution: null,
    license: "CC-BY-4.0",
    forkedFromVersionId: second,
  };
  assert.ok(Either.isRight(await Effect.runPromise(Effect.either(api(fork).fork(second, third)))));
  for (const body of [
    { ...fork, operationId: first },
    { ...fork, forkedFromVersionId: third },
    { ...fork, document: { ...fork.document, id: third } },
    { ...fork, document: { ...fork.document, forkedFromVersionId: third } },
  ]) {
    const result = await Effect.runPromise(Effect.either(api(body).fork(second, third)));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
  const updates = {
    schemaVersion: 1,
    knownVersion: { id: second, version: 1, sourceAreaId: first },
    latestPublicVersion: { id: third, version: 2, sourceAreaId: first, createdAt: timestamp },
  };
  assert.ok(
    Either.isRight(
      await Effect.runPromise(
        Effect.either(api(updates).checkUpdates({ versionId: second, sourceAreaId: first })),
      ),
    ),
  );
  for (const body of [
    { ...updates, knownVersion: { ...updates.knownVersion, id: third } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, sourceAreaId: second } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, id: second } },
    { ...updates, latestPublicVersion: { ...updates.latestPublicVersion, version: 1 } },
  ]) {
    const result = await Effect.runPromise(
      Effect.either(api(body).checkUpdates({ versionId: second, sourceAreaId: first })),
    );
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});

void test("publication client binds acknowledgments to intent, document and provenance", async () => {
  const request = {
    operationId: third,
    sourceAreaId: first,
    content: document,
    visibility: "public",
  };
  const api = (body: unknown) => createPublishingApi(() => Effect.succeed({ status: 200, body }));
  const acknowledgment = { schemaVersion: 1, operationId: third, version };
  assert.ok(
    Either.isRight(await Effect.runPromise(Effect.either(api(acknowledgment).publish(request)))),
  );
  for (const body of [
    { ...acknowledgment, operationId: second },
    { ...acknowledgment, version: { ...version, content: { ...document, id: third } } },
    { ...acknowledgment, version: { ...version, sourceAreaId: third } },
    { ...acknowledgment, version: { ...version, visibility: "private" } },
    { ...acknowledgment, version: { ...version, forkedFromVersionId: third } },
    { ...acknowledgment, version: { ...version, license: "other-license" } },
    { ...acknowledgment, version: { ...version, attribution: "unrequested" } },
  ]) {
    const result = await Effect.runPromise(Effect.either(api(body).publish(request)));
    assert.ok(Either.isLeft(result));
    assert.ok(result.left._tag === "PublishingApiFailure");
    assert.equal(result.left.reason, "invalid-response");
  }
});

void test("publication fork shares definitions, remaps identities, and excludes private study history", () => {
  const activity = {
    id: "custom-activity",
    areaId: first,
    title: "Recall",
    pluginId: "recall.basic",
    pluginVersion: 1,
    revision: 1,
    objectiveIds: [third],
    fallback: "Question",
    payload: { cardId: second, prompts: ["Question"], rubric: "Recall", reference: "Answer" },
  } as const;
  const unknown = {
    ...activity,
    id: "future-activity",
    pluginId: "community.diagram",
    payload: { opaque: { cardId: second, nodes: [true, null, 3] } },
  } as const;
  const portable = valid(KnowledgeAreaSchema, {
    ...document,
    activities: [activity, unknown],
    activityLibrary: {
      version: 1,
      activities: [activity],
      attempts: [{ id: "private-attempt", response: { answers: ["secret"] } }],
      drafts: [{ id: "private-draft", response: { answers: ["secret"] } }],
      editorDrafts: [{ id: "private-editor", fields: { answer: "secret" } }],
    },
  });
  assert.deepEqual(
    Object.keys(portable).sort(),
    Object.keys(document).sort().concat("activities").sort(),
  );
  assert.deepEqual(
    portable.activities?.map((entry) => entry.id),
    ["custom-activity", "future-activity"],
  );
  const fork = Effect.runSync(
    createPublicationFork({
      ownerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      sourceVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      source: portable,
      attribution: null,
      license: null,
    }),
  );
  const forked = fork.document.activities ?? [];
  assert.equal(forked.length, 2);
  const forkedBuiltin = forked[0];
  const forkedUnknown = forked[1];
  const forkedObjective = fork.document.objectives[0];
  const forkedCard = fork.document.cards[0];
  assert.ok(forkedBuiltin);
  assert.ok(forkedUnknown);
  assert.ok(forkedObjective);
  assert.ok(forkedCard);
  assert.notEqual(forkedBuiltin.id, activity.id);
  assert.equal(forkedBuiltin.areaId, fork.document.id);
  assert.deepEqual(forkedBuiltin.objectiveIds, [forkedObjective.id]);
  assert.equal(forkedBuiltin.payload.cardId, forkedCard.id);
  assert.deepEqual(forkedUnknown.payload, unknown.payload);
});
