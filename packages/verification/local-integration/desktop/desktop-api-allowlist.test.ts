import assert from "node:assert/strict";
import test from "node:test";
import { isDesktopApiPathAllowed } from "../../../../apps/desktop/src/main/services/desktop-api-path.js";

const deckId = "123e4567-e89b-42d3-a456-426614174000";
const areaId = "123e4567-e89b-42d3-a456-426614174001";
const versionId = "123e4567-e89b-42d3-a456-426614174002";
const token = "A".repeat(43);

await test("desktop API bridge allows narrowly scoped deck and activity routes", () => {
  assert.equal(
    isDesktopApiPathAllowed("GET", `/api/v1/decks?q=biology&limit=20&cursor=${deckId}`),
    true,
  );
  assert.equal(isDesktopApiPathAllowed("GET", `/api/v1/decks/${deckId}?token=${token}`), true);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/deck-subscriptions/updates"), true);
  assert.equal(
    isDesktopApiPathAllowed("POST", `/api/v1/deck-subscriptions/${areaId}/updates/read`),
    true,
  );
  assert.equal(isDesktopApiPathAllowed("PUT", "/api/v1/deck-subscriptions"), true);
  assert.equal(isDesktopApiPathAllowed("POST", "/api/v1/activities/assess"), true);
  assert.equal(isDesktopApiPathAllowed("POST", `/api/v1/decks/${deckId}/reports`), true);
});

await test("desktop API bridge allows validated discovery filters and bounds", () => {
  assert.equal(
    isDesktopApiPathAllowed(
      "GET",
      "/api/v1/decks?difficulty=beginner&activityType=recall.quiz&minMinutes=1&maxMinutes=1000",
    ),
    true,
  );
  assert.equal(
    isDesktopApiPathAllowed("GET", "/api/v1/decks?activityType=x&minMinutes=1000"),
    true,
  );
  assert.equal(
    isDesktopApiPathAllowed("GET", `/api/v1/decks?activityType=${"x".repeat(200)}`),
    true,
  );
});

await test("desktop API bridge rejects broad routes, access grants, and malformed route data", () => {
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/admin"), false);
  assert.equal(isDesktopApiPathAllowed("GET", `/api/v1/decks/${deckId}/access`), false);
  assert.equal(isDesktopApiPathAllowed("PUT", `/api/v1/decks/${deckId}/access`), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?limit=500"), false);
  assert.equal(
    isDesktopApiPathAllowed("GET", `/api/v1/decks?cursor=${areaId}&cursor=${versionId}`),
    false,
  );
  assert.equal(isDesktopApiPathAllowed("GET", `/api/v1/decks/${deckId}?token=short`), false);
  assert.equal(isDesktopApiPathAllowed("POST", `/api/v1/decks/not-a-uuid/reports`), false);
  assert.equal(isDesktopApiPathAllowed("GET", `/api/v1/activities?owner=${deckId}`), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?difficulty=expert"), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?activityType="), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?activityType=%20"), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?activityType=Recall.Quiz"), false);
  assert.equal(
    isDesktopApiPathAllowed("GET", `/api/v1/decks?activityType=${"x".repeat(201)}`),
    false,
  );
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?minMinutes=0"), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?maxMinutes=1001"), false);
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?minMinutes=31&maxMinutes=30"), false);
  assert.equal(
    isDesktopApiPathAllowed("GET", "/api/v1/decks?difficulty=beginner&difficulty=advanced"),
    false,
  );
  assert.equal(isDesktopApiPathAllowed("GET", "/api/v1/decks?activityType=recall&owner=x"), false);
});
