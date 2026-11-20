import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { SchedulerSettingsSchema, createAreaId } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  buryStudyCard,
  unburyStudyCards,
  isManuallyBuried,
  studyQueue,
  localStudyDay,
  filteredStudyArea,
  presetPolicy,
  recordReview,
} from "@recall/application";
import { remapStudyIdentities } from "../../../sync-core/src/study-identities";
import { workspace, card, now } from "./advanced/fixtures";

function success<A, E>(effect: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}

await test("manual card burial expires at the study boundary and preserves schedules/history", () => {
  const original = workspace([card("a"), card("b")]);
  const area = original.areas[0];
  assert.ok(area);
  const first = area.cards[0];
  assert.ok(first);
  const before = structuredClone(original);
  const settings = success(buryStudyCard(original, first.id, "card", now));
  const buried = { ...original, schedulerSettings: settings };
  const day = localStudyDay(now);
  assert.equal(settings.manualBurials?.[first.id], day.endsAt);
  assert.deepEqual(
    studyQueue(buried, area, now, day).cards.map((item) => item.id),
    ["b"],
  );
  assert.equal(studyQueue(buried, area, now, day).buriedCount, 1);
  const denied = Effect.runSync(
    Effect.either(
      recordReview({
        workspace: buried,
        areaId: area.id,
        cardId: first.id,
        eventId: "buried-answer",
        ratedAt: new Date(now).toISOString(),
        rating: "good",
      }),
    ),
  );
  assert.ok(Either.isLeft(denied));
  assert.equal(denied.left._tag, "ReviewCardUnavailable");
  assert.equal(isManuallyBuried(buried, first.id, day.endsAt), false);
  assert.equal(studyQueue(buried, area, day.endsAt, localStudyDay(day.endsAt)).cards.length, 2);
  assert.deepEqual(original, before);
  assert.deepEqual(buried.areas, before.areas);
  assert.deepEqual(buried.reviewEvents, before.reviewEvents);
  assert.equal("manualBurials" in presetPolicy(settings), false);
  const restored = { ...buried, schedulerSettings: unburyStudyCards(buried) };
  assert.equal(studyQueue(restored, area, now, day).cards.length, 2);
  assert.equal(success(filteredStudyArea(buried, area, "", now)).cards.length, 1);
});

await test("note burial includes canonical source siblings across subjects, not unrelated cards", () => {
  const first = card("a");
  const initial = workspace([{ ...first, noteId: "source" }, card("unrelated")]);
  const owner = initial.areas[0];
  assert.ok(owner);
  const note = {
    id: "source",
    typeId: BASIC_NOTE_TYPE.id,
    fields: { Front: "Q", Back: "A" },
    tags: [],
    objectiveIds: [],
  };
  const cross = {
    ...initial,
    areas: [
      { ...owner, noteLibrary: { types: [BASIC_NOTE_TYPE], notes: [note] } },
      {
        ...owner,
        id: createAreaId("other"),
        cards: [{ ...card("sibling"), noteId: "copy" }],
        noteLibrary: {
          types: [BASIC_NOTE_TYPE],
          notes: [
            {
              ...note,
              id: "copy",
              source: { areaId: owner.id, noteId: note.id, revision: "a".repeat(64) },
            },
          ],
        },
      },
    ],
  };
  const settings = success(buryStudyCard(cross, first.id, "note", now));
  assert.deepEqual(Object.keys(settings.manualBurials ?? {}).sort(), ["a", "sibling"]);
  const normalized = remapStudyIdentities(
    { ...cross, schedulerSettings: settings },
    { area: (id) => id, card: (id) => `mapped-${id}`, event: (id) => id },
  );
  assert.deepEqual(Object.keys(normalized.schedulerSettings?.manualBurials ?? {}).sort(), [
    "mapped-a",
    "mapped-sibling",
  ]);
});

await test("burial rejects invalid times and invalid persisted values without modifying a workspace", () => {
  const initial = workspace();
  const first = initial.areas[0]?.cards[0];
  assert.ok(first);
  assert.ok(
    Either.isLeft(Effect.runSync(Effect.either(buryStudyCard(initial, first.id, "card", NaN)))),
  );
  assert.ok(
    Either.isLeft(
      Schema.decodeUnknownEither(SchedulerSettingsSchema)({
        requestRetention: 0.9,
        manualBurials: { a: -1 },
      }),
    ),
  );
});
