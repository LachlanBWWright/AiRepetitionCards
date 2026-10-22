#!/usr/bin/env python3
"""Exercise study synchronization through Release ASP.NET against local Supabase.

Run via verify-api.py --study --local-supabase after building Release and applying
migrations. Fixtures use new Auth users and UUIDs; existing workspace rows are untouched.
"""

from __future__ import annotations

import copy
import sys
import uuid

from verify_deck_sharing_http import (
    CheckFailure, checked, loopback_origin, request, require, required_secret,
)


def identifier():
    return str(uuid.uuid4())


class Fixture:
    def __init__(self):
        self.api_url = loopback_origin("RECALL_INTEGRATION_API_URL")
        self.url = loopback_origin("RECALL_INTEGRATION_SUPABASE_URL")
        self.key = required_secret("RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY")
        self.service = required_secret("RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY")
        self.users = []
        self.run_id = identifier()

    def db(self, path, method="GET", body=None, token=None, service=False):
        return request(self.url, path, method, body,
                       self.service if service else token, self.service if service else self.key)

    def api(self, path, method="GET", body=None, token=None):
        return request(self.api_url, path, method, body, token)

    def actor(self, label):
        email = f"recall-study-http-{self.run_id}-{label}@example.com"
        password = identifier() + "aA1!"
        user = checked("Create isolated study account", self.db("/auth/v1/admin/users", "POST",
            {"email": email, "password": password, "email_confirm": True,
             "user_metadata": {"recall_study_http_run": self.run_id}}, service=True), (200, 201))
        require(isinstance(user, dict) and isinstance(user.get("id"), str), "Invalid Auth fixture.")
        self.users.append(str(uuid.UUID(user["id"])))
        session = checked("Authenticate study account", self.db("/auth/v1/token?grant_type=password",
            "POST", {"email": email, "password": password}), (200,))
        require(isinstance(session, dict) and isinstance(session.get("access_token"), str),
                "Invalid Auth session.")
        return session["access_token"]

    def cleanup(self):
        failures = []
        for user in self.users:
            for label, path, method, body in [
                ("account data", "/rest/v1/rpc/erase_account_data", "POST", {"p_user_id": user}),
                ("Auth account", f"/auth/v1/admin/users/{user}", "DELETE", None),
            ]:
                try:
                    status, _ = self.db(path, method, body, service=True)
                    if status < 200 or status >= 300:
                        failures.append(label)
                except CheckFailure:
                    failures.append(label)
        return failures


def area(card_id=None):
    return {"schemaVersion": "1.0.0", "id": identifier(), "title": "Study HTTP fixture",
        "description": "Isolated acceptance fixture", "language": "en", "difficulty": "beginner",
        "objectives": [], "ai": {"tutorInstructions": "", "quizInstructions": None,
            "cardGenerationInstructions": None}, "cards": [] if card_id is None else [{
            "kind": "basic", "id": card_id, "front": "Question", "back": "Answer",
            "objectiveIds": [], "tags": [], "origin": "authored"}],
        "tags": [], "licence": "CC0-1.0", "attribution": None}


def entry(document, content_hash=None):
    return {"document": document, "color": "#3b82f6", "baseContentHash": content_hash}


def push(fixture, token, documents, statuses=(200,)):
    return checked("Push private workspace batch", fixture.api("/api/v1/workspace", "POST",
        {"schemaVersion": 1, "areas": documents, "tombstones": []}, token), statuses)


def latest_hash(fixture, token, area_id):
    rows = checked("Read current owned content hash", fixture.db(
        "/rest/v1/knowledge_area_versions?select=content_hash&knowledge_area_id=eq."
        + area_id + "&order=version.desc&limit=1", token=token), (200,))
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0].get("content_hash"), str),
            "Current content hash missing.")
    return rows[0]["content_hash"]


def study_document(adjustments=None):
    return {"settings": {"requestRetention": 0.9}, "adjustments": adjustments or [],
            "corrections": [], "undoStates": [], "importedSchedules": []}


def verify_study(fixture, token, other_token, source, card_id):
    path = "/api/v1/workspace/study/pages"
    empty = checked("Read new study page", fixture.api(path, token=token), (200,))
    require(empty.get("revision") == 0 and empty["document"]["adjustments"] == [],
            "New account had unexpected study data.")
    adjustment = {"id": identifier(), "areaId": source["id"], "cardId": card_id,
        "kind": "due", "recordedAt": "2026-10-01T00:00:00.000Z",
        "due": "2026-10-02T00:00:00.000Z", "afterReviewEventId": None}
    saved = checked("Append study metadata", fixture.api(path, "POST",
        {"revision": 0, "document": study_document([adjustment])}, token), (200,))
    require(saved.get("revision") == 1, "Study revision did not advance.")
    checked("Reject stale study revision", fixture.api(path, "POST",
        {"revision": 0, "document": study_document()}, token), (409,))
    mutation = dict(adjustment, due="2026-10-03T00:00:00.000Z")
    checked("Reject modification of append-only metadata", fixture.api(path, "POST",
        {"revision": 1, "document": study_document([mutation])}, token), (409,))
    checked("Append empty batch without deleting history", fixture.api(path, "POST",
        {"revision": 1, "document": study_document()}, token), (200,))
    page = checked("Read preserved study metadata", fixture.api(path, token=token), (200,))
    require(page.get("revision") == 2 and page["document"]["adjustments"] == [adjustment],
            "Batch sync changed or dropped append-only history.")
    isolated = checked("Read unrelated account study page", fixture.api(path, token=other_token), (200,))
    require(isolated.get("revision") == 0 and isolated["document"]["adjustments"] == [],
            "Study metadata leaked across accounts.")
    checked("Reject anonymous study access", fixture.api(path), (401,))
    corrections = [{"id": identifier(), "eventId": identifier(),
                    "recordedAt": "2026-10-01T00:00:00.000Z"} for _ in range(5001)]
    for revision, chunk in [(2, corrections[:2500]), (3, corrections[2500:])]:
        document = study_document()
        document["corrections"] = chunk
        checked("Append bounded study history chunk", fixture.api(path, "POST",
            {"revision": revision, "document": document}, token), (200,))
    first = checked("Read full study history page", fixture.api(path, token=token), (200,))
    cursor = first.get("nextCursor")
    require(isinstance(cursor, int) and cursor > 0, "Large history did not return a page cursor.")
    second = checked("Read remaining study history page", fixture.api(
        path + "?after=" + str(cursor), token=token), (200,))
    require(second.get("nextCursor") is None and first.get("revision") == 4
            and second.get("revision") == 4, "Study pagination revision or completion was invalid.")
    all_corrections = first["document"]["corrections"] + second["document"]["corrections"]
    require(len(all_corrections) == 5001 and {item["id"] for item in all_corrections}
            == {item["id"] for item in corrections}, "Paged history lost or duplicated entries.")


def review(fixture, token, card_id):
    operation = {"id": identifier(), "cardId": card_id, "deviceSequence": 1,
        "reviewedAtDevice": "2026-10-01T00:00:00.000Z",
        "effectiveReviewedAt": "2026-10-01T00:00:00.000Z", "rating": "good",
        "schedulerFamily": "fsrs", "schedulerVersion": "6", "baseReviewEventId": None,
        "elapsedMs": 1000, "schedulerParameterSetId": None, "previousStateHash": None}
    body = {"schemaVersion": 1, "deviceId": identifier(), "operations": [operation]}
    response = checked("Upload real review event", fixture.api("/api/v1/sync", "POST", body, token), (200,))
    require(response.get("acceptedIds") == [operation["id"]], "Review event was not accepted.")
    return body


def verify_move(fixture, token, other_token, source, destination, card_id):
    original = review(fixture, token, card_id)
    source_hash = latest_hash(fixture, token, source["id"])
    destination_hash = latest_hash(fixture, token, destination["id"])
    moved_source, moved_destination = copy.deepcopy(source), copy.deepcopy(destination)
    moved_destination["cards"] = moved_source["cards"]
    moved_source["cards"] = []
    push(fixture, token, [entry(moved_destination, destination_hash)], (409,))
    push(fixture, token, [entry(moved_source, source_hash), entry(moved_destination, destination_hash)])
    identity = checked("Read stable identity after move", fixture.api(
        "/api/v1/workspace/review-identities", "POST",
        {"schemaVersion": 1, "cardIds": [card_id]}, token), (200,))
    require(identity.get("reviewCards") == [{"id": card_id, "areaId": destination["id"], "deleted": False}],
            "Move did not preserve the card identity at its new placement.")
    retried = checked("Retry original review after move", fixture.api("/api/v1/sync", "POST", original, token), (200,))
    require(retried.get("acceptedIds") == [original["operations"][0]["id"]], "Move invalidated review retry.")
    changes = checked("Read historical review after move", fixture.api("/api/v1/sync", token=token), (200,))
    events = [change["payload"] for change in changes.get("changes", []) if change.get("entityType") == "review_event"]
    require(len(events) == 1 and events[0]["cardId"] == card_id and events[0]["areaId"] == destination["id"],
            "Review history identity was lost after moving the reviewed card.")
    hidden = checked("Review identity is account-private", fixture.api(
        "/api/v1/workspace/review-identities", "POST",
        {"schemaVersion": 1, "cardIds": [card_id]}, other_token), (200,))
    require(hidden.get("reviewCards") == [], "Review identity leaked across accounts.")


def verify_linked_family(fixture, token):
    source, destination = area(), area()
    note_type = {"id": "basic", "name": "Basic", "fields": [{"name": "Front"}, {"name": "Back"}],
        "templates": [{"id": "basic", "name": "Basic", "front": "{{Front}}", "back": "{{Back}}"}]}
    objective_id = identifier()
    source["objectives"] = [{"id": objective_id, "title": "Linked objective",
                              "description": None, "prerequisiteIds": []}]
    note = {"id": "source-note", "typeId": "basic", "fields": {"Front": "Q", "Back": "A"},
        "tags": [], "objectiveIds": [objective_id]}
    source["noteLibrary"] = {"types": [note_type], "notes": [note]}
    linked = dict(note, id="linked-note", source={"areaId": source["id"],
        "noteId": note["id"], "revision": "a" * 64})
    destination_objective = identifier()
    destination["objectives"] = [{"id": destination_objective, "title": "Linked objective",
        "description": None, "prerequisiteIds": []}]
    linked["objectiveIds"] = [destination_objective]
    destination["noteLibrary"] = {"types": [note_type], "notes": [linked]}
    push(fixture, token, [entry(source), entry(destination)])
    source_hash = latest_hash(fixture, token, source["id"])
    destination_hash = latest_hash(fixture, token, destination["id"])
    changed = copy.deepcopy(source)
    changed["title"] = "Atomic linked source update"
    push(fixture, token, [entry(changed, source_hash)], (409,))
    require(latest_hash(fixture, token, source["id"]) == source_hash,
            "Rejected partial linked update modified persisted content.")
    push(fixture, token, [entry(changed, source_hash), entry(destination, destination_hash)])
    stale = copy.deepcopy(changed)
    stale["title"] = "Stale atomic batch"
    push(fixture, token, [entry(stale, source_hash), entry(destination, destination_hash)], (409,))
    require(latest_hash(fixture, token, destination["id"]) == destination_hash,
            "Stale batch partially modified linked destination.")


def run(fixture):
    token, other = fixture.actor("owner"), fixture.actor("other")
    card_id = identifier()
    source, destination = area(card_id), area()
    push(fixture, token, [entry(source), entry(destination)])
    verify_study(fixture, token, other, source, card_id)
    verify_move(fixture, token, other, source, destination, card_id)
    verify_linked_family(fixture, token)


def main():
    fixture = None
    failure = None
    cleanup_failures = []
    try:
        fixture = Fixture()
        run(fixture)
    except CheckFailure as error:
        failure = str(error)
    except (AssertionError, KeyError, TypeError, ValueError):
        failure = "Invalid study-sync acceptance fixture or response."
    finally:
        if fixture is not None:
            cleanup_failures = fixture.cleanup()
    if failure:
        print("Study-sync HTTP verification failed: " + failure, file=sys.stderr)
    if cleanup_failures:
        print("Scoped study fixture cleanup failed: " + ", ".join(cleanup_failures), file=sys.stderr)
    if failure or cleanup_failures:
        return 1
    print("All ASP.NET study-sync HTTP checks passed; isolated fixtures removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
