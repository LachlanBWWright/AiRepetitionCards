import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createTutorApi,
  prepareReviewRepairCommand,
  requestReviewRepair,
  applyWorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
} from "@recall/application";
import { recordReview } from "@recall/application";
import { workspace, uuid, time } from "../workspace/workspace-sync-fixtures";

const refinement = {
  summary: "Two smaller facts",
  cards: [
    {
      front: "What carries genetic information?",
      back: "DNA",
      objectiveId: null,
      rationale: "One fact",
      meaningChanged: true,
      sourceReferences: [],
    },
    {
      front: "Where is most human-cell DNA stored?",
      back: "The nucleus",
      objectiveId: null,
      rationale: "One fact",
      meaningChanged: true,
      sourceReferences: [],
    },
  ],
};
function fixture() {
  const initial = workspace([]);
  const area = initial.areas[0];
  assert.ok(area);
  const card = area.cards[0];
  assert.ok(card);
  const reviewed = Effect.runSync(
    recordReview({
      workspace: initial,
      areaId: area.id,
      cardId: card.id,
      rating: "good",
      eventId: uuid(400),
      ratedAt: time,
    }),
  ).workspace;
  return { initial: reviewed, area, card };
}
await test("AI split approval preserves original history and retains the original in recoverable deletion", () => {
  const { initial, area, card } = fixture();
  let sequence = 500;
  const command = Effect.runSync(
    prepareReviewRepairCommand(
      initial,
      area.id,
      card,
      "split",
      refinement,
      () => uuid(sequence++),
      false,
    ),
  );
  assert.equal(initial.areas[0]?.cards.length, 1);
  const saved = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      initial,
      command,
      new Date(time),
      workspaceAuthoringBaseline(initial, command),
    ),
  ).workspace;
  assert.equal(saved.areas[0]?.cards.length, 2);
  assert.equal(saved.reviewEvents?.length, 1);
  assert.ok(saved.areas[0].cards.every((item) => item.schedule.state === 0));
  assert.ok(saved.cardVersions?.some((version) => version.cardId === card.id));
});
await test("prerequisites retain the original schedule and reject approval after a source edit", () => {
  const { initial, area, card } = fixture();
  const command = Effect.runSync(
    prepareReviewRepairCommand(
      initial,
      area.id,
      card,
      "prerequisite",
      { ...refinement, cards: refinement.cards.slice(0, 1) },
      () => uuid(600),
      false,
    ),
  );
  const baseline = workspaceAuthoringBaseline(initial, command);
  assert.notEqual(baseline, undefined);
  const saved = Effect.runSync(
    applyWorkspaceAuthoringCommand(initial, command, new Date(time), baseline),
  ).workspace;
  assert.deepEqual(
    saved.areas[0]?.cards.find((item) => item.id === card.id)?.schedule,
    initial.areas[0]?.cards[0]?.schedule,
  );
  const changed = {
    ...initial,
    areas: initial.areas.map((item) => ({
      ...item,
      cards: item.cards.map((c) => ({ ...c, front: "Changed while AI was working" })),
    })),
  };
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(applyWorkspaceAuthoringCommand(changed, command, new Date(time), baseline)),
      ),
    ),
  );
});
await test("malformed AI proposals cannot reach authoring commands", () => {
  const { initial, area, card } = fixture();
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          prepareReviewRepairCommand(
            initial,
            area.id,
            card,
            "split",
            { cards: [] },
            () => uuid(700),
            false,
          ),
        ),
      ),
    ),
  );
});
await test("review help routes inspection through the validated provider without modifying cards", () => {
  const { initial, area, card } = fixture();
  let requested = "";
  const api = createTutorApi((input) => {
    requested = input.path;
    return Effect.succeed({ status: 503, body: { error: "provider-unavailable" } });
  });
  const result = Effect.runSync(
    Effect.either(requestReviewRepair(api, area, card, "ambiguity", Date.parse(time))),
  );
  assert.ok(Either.isLeft(result));
  assert.ok(requested.length > 0);
  assert.equal(initial.areas[0]?.cards.length, 1);
});

for (const action of ["explain", "ambiguity", "split", "prerequisite"] as const) {
  await test(`review help preserves actionable provider failures for ${action}`, () => {
    const { area, card } = fixture();
    const recovery =
      "OpenAI could not count this request’s tokens. Nothing was sent for generation because Recall could not verify the 100,000-token limit. Retry the request.";
    const api = createTutorApi(() => Effect.succeed({ status: 503, body: { error: recovery } }));
    const result = Effect.runSync(
      Effect.either(requestReviewRepair(api, area, card, action, Date.parse(time))),
    );
    assert.ok(Either.isLeft(result));
    assert.ok(result.left.message.includes(recovery), result.left.message);
    assert.ok(result.left.message.includes("Your original card and review history are unchanged."));
  });
}

await test("review help distinguishes invalid responses from connectivity failures", () => {
  const { area, card } = fixture();
  const api = createTutorApi(() => Effect.succeed({ status: 200, body: {} }));
  const result = Effect.runSync(
    Effect.either(requestReviewRepair(api, area, card, "explain", Date.parse(time))),
  );
  assert.ok(Either.isLeft(result));
  assert.match(result.left.message, /could not validate/);
  assert.doesNotMatch(result.left.message, /checking the connection/);
});

await test("review help identifies transport failures with network recovery", () => {
  const { area, card } = fixture();
  const api = createTutorApi(() => Effect.fail({ _tag: "TutorTransportError" }));
  const result = Effect.runSync(
    Effect.either(requestReviewRepair(api, area, card, "explain", Date.parse(time))),
  );
  assert.ok(Either.isLeft(result));
  assert.match(result.left.message, /Check your network and API URL/);
});
