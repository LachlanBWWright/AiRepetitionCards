#!/usr/bin/env python3
"""Exercise the local ASP.NET deck-sharing API against explicitly configured Supabase."""

from __future__ import annotations

import os
import secrets
import sys
import urllib.parse
import uuid
from typing import Any

from verify_deck_sharing_http import (
    CheckFailure, checked, loopback_origin, request, require, required_secret,
)
from verify_deck_sharing_publication import verify_publication_and_following

SUPABASE_URL = ""
API_URL = ""
PUBLISHABLE_KEY = ""
SERVICE_ROLE_KEY = ""
MODERATOR_ACCESS_TOKEN: str | None = None

created_users: list[str] = []
area_ids: list[str] = []
publication_ids: list[str] = []
run_id = str(uuid.uuid4())


def api(path: str, method: str = "GET", body: Any = None, token: str | None = None) -> tuple[int, Any]:
    return request(API_URL, path, method, body, token)


def supabase(
    path: str,
    method: str = "GET",
    body: Any = None,
    token: str | None = None,
    *,
    service: bool = False,
) -> tuple[int, Any]:
    key = SERVICE_ROLE_KEY if service else PUBLISHABLE_KEY
    auth = token if token is not None else (SERVICE_ROLE_KEY if service else None)
    return request(SUPABASE_URL, path, method, body, auth, key)


def actor(label: str) -> tuple[str, str]:
    email = f"recall-deck-http-{run_id}-{label}@example.com"
    password = f"{uuid.uuid4()}-aA1!"
    created = checked(
        "Create isolated Auth fixture",
        supabase(
            "/auth/v1/admin/users",
            "POST",
            {"email": email, "password": password, "email_confirm": True,
                "user_metadata": {"recall_deck_http_run": run_id}},
            service=True,
        ),
        (200, 201),
    )
    require(isinstance(created, dict) and isinstance(created.get("id"), str), "Auth fixture response was invalid.")
    user_id = str(uuid.UUID(created["id"]))
    created_users.append(user_id)
    signed_in = checked(
        "Sign in isolated Auth fixture",
        supabase(
            "/auth/v1/token?grant_type=password",
            "POST",
            {"email": email, "password": password},
        ),
        (200,),
    )
    require(
        isinstance(signed_in, dict)
        and isinstance(signed_in.get("access_token"), str)
        and isinstance(signed_in.get("user"), dict)
        and signed_in["user"].get("id") == user_id,
        "Auth fixture session identity was invalid.",
    )
    return user_id, signed_in["access_token"]


def cleanup() -> list[str]:
    failures: list[str] = []

    def attempt(label: str, path: str, method: str = "DELETE", body: Any = None) -> None:
        try:
            status, _ = supabase(path, method, body, service=True)
            if not 200 <= status < 300:
                failures.append(label)
        except CheckFailure:
            failures.append(label)

    if area_ids:
        joined = ",".join(area_ids)
        attempt("feedback cleanup", f"/rest/v1/deck_feedback?deck_id=in.({joined})")
        attempt("report cleanup", f"/rest/v1/deck_reports?deck_id=in.({joined})")
        attempt("subscription cleanup", f"/rest/v1/deck_subscriptions?area_id=in.({joined})")
        attempt("update read cleanup", f"/rest/v1/deck_update_reads?area_id=in.({joined})")
        attempt("deck registry cleanup", f"/rest/v1/shared_decks?deck_id=in.({joined})")
    for publication_id in publication_ids:
        attempt(
            "publication cleanup",
            f"/rest/v1/published_knowledge_area_versions?id=eq.{publication_id}",
        )
    if area_ids:
        attempt(
            "fixture publication sweep",
            "/rest/v1/published_knowledge_area_versions?source_area_id=in.("
            + ",".join(area_ids)
            + ")",
        )
    for user_id in created_users:
        attempt(
            "account data cleanup",
            "/rest/v1/rpc/erase_account_data",
            "POST",
            {"p_user_id": user_id},
        )
        attempt("Auth user cleanup", f"/auth/v1/admin/users/{user_id}")
    return failures


def run() -> None:
    health = checked("ASP.NET health", api("/health"), (200,))
    del health
    owner_id, owner_token = actor("owner")
    _, viewer_token = actor("viewer")
    area_id = str(uuid.uuid4())
    area_ids.append(area_id)
    objective_id = str(uuid.uuid4())
    card_id = str(uuid.uuid4())
    activity_id = str(uuid.uuid4())
    unknown_activity_id = str(uuid.uuid4())
    document = {
        "schemaVersion": "1.0.0",
        "id": area_id,
        "title": "Deck sharing HTTP fixture",
        "description": "Isolated loopback-only integration fixture",
        "language": "en",
        "difficulty": "beginner",
        "objectives": [{"id": objective_id, "title": "Fixture objective", "description": None,
                        "prerequisiteIds": []}],
        "ai": {"tutorInstructions": "", "quizInstructions": None,
               "cardGenerationInstructions": None},
        "cards": [{"kind": "basic", "id": card_id, "front": "Fixture question",
                   "back": "Fixture answer", "objectiveIds": [objective_id], "tags": [],
                   "origin": "authored"}],
        "tags": ["integration"],
        "licence": "CC0-1.0",
        "attribution": None,
        "activities": [
            {
                "id": activity_id,
                "areaId": area_id,
                "title": "Fixture built-in activity",
                "pluginId": "recall.basic",
                "pluginVersion": 1,
                "revision": 1,
                "objectiveIds": [objective_id],
                "fallback": "Fixture question",
                "payload": {
                    "prompts": ["Fixture question"],
                    "rubric": "Recall the answer.",
                    "reference": "Fixture answer",
                    "cardId": card_id,
                },
            },
            {
                "id": unknown_activity_id,
                "areaId": area_id,
                "title": "Fixture unknown plugin activity",
                "pluginId": "community.diagram",
                "pluginVersion": 7,
                "revision": 1,
                "objectiveIds": [objective_id],
                "fallback": "Interpret this diagram.",
                "payload": {"opaque": {"cardId": card_id, "nodes": ["A", True, None, 3]}},
            },
        ],
    }

    version_id, update_version_id, publication_request = verify_publication_and_following(
        api,
        owner_id=owner_id,
        owner_token=owner_token,
        viewer_token=viewer_token,
        document=document,
        area_id=area_id,
        card_id=card_id,
        activity_id=activity_id,
        unknown_activity_id=unknown_activity_id,
        area_ids=area_ids,
        publication_ids=publication_ids,
    )
    feedback_id = str(uuid.uuid4())
    feedback = {"id": feedback_id, "versionId": version_id, "cardId": card_id,
                "message": "Please clarify this question.", "kind": "suggestion"}
    checked("Submit feedback through ASP.NET",
            api(f"/api/v1/decks/{area_id}/feedback", "POST", feedback, viewer_token), (200, 201))
    checked("Resolve feedback through ASP.NET",
            api(f"/api/v1/decks/{area_id}/feedback/{feedback_id}", "PATCH",
                {"status": "resolved"}, owner_token), (200,))
    retry = checked("Retry feedback idempotently",
                    api(f"/api/v1/decks/{area_id}/feedback", "POST", feedback, viewer_token), (200, 201))
    require(isinstance(retry, dict) and any(
        isinstance(item, dict) and item.get("id") == feedback_id and item.get("status") == "resolved"
        for item in retry.get("feedback", [])), "Feedback retry changed the resolved owner status.")

    report_id = str(uuid.uuid4())
    report_body = {"id": report_id, "versionId": update_version_id, "reason": "broken",
                   "message": "Fixture report for integration verification."}
    report = checked("Submit public deck report",
        api(f"/api/v1/decks/{area_id}/reports", "POST", report_body, viewer_token), (200, 201))
    repeated_report = checked("Retry report with same idempotency key",
        api(f"/api/v1/decks/{area_id}/reports", "POST", report_body, viewer_token), (200, 201))
    require(isinstance(report, dict) and report.get("reportId") == report_id
            and isinstance(repeated_report, dict) and repeated_report.get("reportId") == report_id,
            "Report retry did not return the canonical report ID.")
    checked("Reject moderation queue for ordinary user", api("/api/v1/moderation/reports", token=viewer_token), (401, 403))
    if MODERATOR_ACCESS_TOKEN:
        operator_queue = checked(
            "Read operator report queue",
            api("/api/v1/moderation/reports", token=MODERATOR_ACCESS_TOKEN),
            (200,),
        )
        require(
            isinstance(operator_queue, dict)
            and any(isinstance(item, dict) and item.get("id") == report_id and item.get("status") == "open"
                    for item in operator_queue.get("reports", [])),
            "Operator report queue omitted the open fixture report.",
        )
        resolved = checked(
            "Resolve report as operator",
            api(f"/api/v1/moderation/reports/{report_id}", "PATCH", {"status": "resolved"}, MODERATOR_ACCESS_TOKEN),
            (200,),
        )
        require(isinstance(resolved, dict) and resolved.get("ok") is True, "Operator report resolution was not confirmed.")
        updated_queue = checked(
            "Confirm report status in operator queue",
            api("/api/v1/moderation/reports", token=MODERATOR_ACCESS_TOKEN),
            (200,),
        )
        require(
            isinstance(updated_queue, dict)
            and any(isinstance(item, dict) and item.get("id") == report_id and item.get("status") == "resolved"
                    for item in updated_queue.get("reports", [])),
            "Operator report resolution did not persist.",
        )
        hidden = checked(
            "Hide deck as operator",
            api(f"/api/v1/moderation/decks/{area_id}", "PATCH",
                {"status": "hidden", "reason": "Fixture moderation visibility check."}, MODERATOR_ACCESS_TOKEN),
            (200,),
        )
        require(isinstance(hidden, dict) and hidden.get("ok") is True, "Operator deck hide was not confirmed.")
        checked("Hidden deck absent from anonymous detail", api(f"/api/v1/decks/{area_id}"), (404,))
        owner_hidden = checked("Owner retains hidden deck access", api(f"/api/v1/decks/{area_id}", token=owner_token), (200,))
        require(isinstance(owner_hidden, dict) and isinstance(owner_hidden.get("deck"), dict)
                and owner_hidden["deck"].get("id") == area_id, "Moderation hide removed owner access.")
        republish_request = {
            **publication_request,
            "operationId": str(uuid.uuid4()),
            "releaseNotes": "Republish must not clear moderation state.",
        }
        republished = checked(
            "Republish hidden deck as owner",
            api("/api/v1/knowledge-areas", "POST", republish_request, owner_token),
            (200, 201),
        )
        require(isinstance(republished, dict) and isinstance(republished.get("version"), dict),
                "Republish response for hidden deck was invalid.")
        republished_id = str(uuid.UUID(republished["version"].get("id", "")))
        publication_ids.append(republished_id)
        checked("Author republish cannot clear moderation hide", api(f"/api/v1/decks/{area_id}"), (404,))
        visible = checked(
            "Restore deck as operator",
            api(f"/api/v1/moderation/decks/{area_id}", "PATCH",
                {"status": "visible", "reason": "Restore fixture visibility after verification."}, MODERATOR_ACCESS_TOKEN),
            (200,),
        )
        require(isinstance(visible, dict) and visible.get("ok") is True, "Operator deck restore was not confirmed.")
        audit_read = supabase(
            f"/rest/v1/deck_moderation_audit?select=id&target_id=eq.{area_id}",
            token=MODERATOR_ACCESS_TOKEN,
        )
        require(audit_read[0] >= 400, "Authenticated operator directly read the protected moderation audit table.")
    else:
        print("Optional successful operator-route checks skipped: RECALL_INTEGRATION_MODERATOR_ACCESS_TOKEN was not set.")

    blocked = checked("Block publisher", api(f"/api/v1/decks/{area_id}/block", "POST", token=viewer_token), (200,))
    require(isinstance(blocked, dict) and blocked.get("blocked") is True, "Publisher block was not confirmed.")
    blocked_catalog = checked("Blocked publisher hidden from catalog", api(
        "/api/v1/decks?" + urllib.parse.urlencode({"q": "Deck sharing HTTP fixture"}), token=viewer_token), (200,))
    require(isinstance(blocked_catalog, dict) and all(
        not isinstance(deck, dict) or deck.get("id") != area_id for deck in blocked_catalog.get("decks", [])
    ), "Blocking a publisher did not hide its public deck from discovery.")
    blocked_updates = checked("Updates hidden after publisher block", api("/api/v1/deck-subscriptions/updates", token=viewer_token), (200,))
    require(isinstance(blocked_updates, dict) and not any(
        isinstance(item, dict) and item.get("deckId") == area_id
        for item in blocked_updates.get("updates", [])
    ), "Blocking a publisher did not hide its updates.")
    unblocked = checked("Unblock publisher", api(f"/api/v1/decks/{area_id}/block", "DELETE", token=viewer_token), (200,))
    require(isinstance(unblocked, dict) and unblocked.get("blocked") is False, "Publisher unblock was not confirmed.")

    old_unlisted_token = secrets.token_urlsafe(32)
    unlisted_request = {**publication_request, "operationId": str(uuid.uuid4()), "visibility": "unlisted",
                        "shareToken": old_unlisted_token, "releaseNotes": "Private link release."}
    old_unlisted = checked("Publish unlisted link release",
        api("/api/v1/knowledge-areas", "POST", unlisted_request, owner_token), (200, 201))
    require(isinstance(old_unlisted, dict) and isinstance(old_unlisted.get("version"), dict)
            and old_unlisted.get("shareToken") == old_unlisted_token,
            "Unlisted publication did not return its link token.")
    old_unlisted_id = str(uuid.UUID(old_unlisted["version"].get("id", "")))
    publication_ids.append(old_unlisted_id)
    checked("Exact unlisted version link", api(
        f"/api/v1/published/{old_unlisted_id}?token={urllib.parse.quote(old_unlisted_token)}"), (200,))
    checked("Public deck detail stays hidden after unlisted release", api(f"/api/v1/decks/{area_id}"), (404,))
    unlisted_catalog = checked("Unlisted deck stays out of public discovery", api(
        "/api/v1/decks?" + urllib.parse.urlencode({"q": "Deck sharing HTTP fixture"})), (200,))
    require(isinstance(unlisted_catalog, dict) and all(
        not isinstance(deck, dict) or deck.get("id") != area_id for deck in unlisted_catalog.get("decks", [])
    ), "Exact link sharing also appeared in public discovery.")

    latest_unlisted_token = secrets.token_urlsafe(32)
    latest_unlisted_request = {**publication_request, "operationId": str(uuid.uuid4()), "visibility": "unlisted",
                               "shareToken": latest_unlisted_token, "releaseNotes": "Later private link release."}
    latest_unlisted = checked("Publish another unlisted release",
        api("/api/v1/knowledge-areas", "POST", latest_unlisted_request, owner_token), (200, 201))
    require(isinstance(latest_unlisted, dict) and isinstance(latest_unlisted.get("version"), dict),
            "Later unlisted release response was invalid.")
    latest_unlisted_id = str(uuid.UUID(latest_unlisted["version"].get("id", "")))
    publication_ids.append(latest_unlisted_id)
    checked("Prior exact unlisted link remains valid", api(
        f"/api/v1/published/{old_unlisted_id}?token={urllib.parse.quote(old_unlisted_token)}"), (200,))
    checked("Older token cannot read later unlisted version", api(
        f"/api/v1/published/{latest_unlisted_id}?token={urllib.parse.quote(old_unlisted_token)}"), (404,))
    checked("Older token cannot resolve latest stable landing", api(
        f"/api/v1/decks/{area_id}?token={urllib.parse.quote(old_unlisted_token)}"), (404,))
    checked("Latest token resolves stable unlisted landing", api(
        f"/api/v1/decks/{area_id}?token={urllib.parse.quote(latest_unlisted_token)}"), (200,))
    link_report_id = str(uuid.uuid4())
    link_report = checked("Report accessible unlisted release", api(
        f"/api/v1/decks/{area_id}/reports", "POST",
        {"id": link_report_id, "versionId": latest_unlisted_id, "reason": "spam",
         "message": "Fixture report for exact unlisted link.", "token": latest_unlisted_token},
        viewer_token), (200, 201))
    require(isinstance(link_report, dict) and link_report.get("reportId") == link_report_id,
            "Unlisted link report was not accepted for its exact version.")
    link_block = checked("Block unlisted publisher with link token", api(
        f"/api/v1/decks/{area_id}/block", "POST", {"token": latest_unlisted_token}, viewer_token), (200,))
    require(isinstance(link_block, dict) and link_block.get("blocked") is True,
            "Unlisted token did not authorize its publisher block.")
    link_unblock = checked("Unblock unlisted publisher with link token", api(
        f"/api/v1/decks/{area_id}/block", "DELETE", {"token": latest_unlisted_token}, viewer_token), (200,))
    require(isinstance(link_unblock, dict) and link_unblock.get("blocked") is False,
            "Unlisted token did not authorize publisher unblock.")

    withdrawal = api(f"/api/v1/decks/{area_id}", "PATCH", {"status": "withdrawn"}, owner_token)
    checked("Withdraw shared deck", withdrawal, (200,))
    checked("Withdrawal hides anonymous version", api(f"/api/v1/published/{version_id}"), (404,))
    checked("Withdrawal hides follower version without capability",
            api(f"/api/v1/published/{version_id}", token=viewer_token), (404,))
    checked("Owner retains withdrawn history",
            api(f"/api/v1/published/{version_id}", token=owner_token), (200,))


def main() -> int:
    global SUPABASE_URL, API_URL, PUBLISHABLE_KEY, SERVICE_ROLE_KEY, MODERATOR_ACCESS_TOKEN
    try:
        SUPABASE_URL = loopback_origin("RECALL_INTEGRATION_SUPABASE_URL")
        API_URL = loopback_origin("RECALL_INTEGRATION_API_URL")
        PUBLISHABLE_KEY = required_secret("RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY")
        SERVICE_ROLE_KEY = required_secret("RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY")
        moderator_token = os.environ.get("RECALL_INTEGRATION_MODERATOR_ACCESS_TOKEN", "")
        require(moderator_token == moderator_token.strip(),
                "RECALL_INTEGRATION_MODERATOR_ACCESS_TOKEN must not contain surrounding whitespace.")
        MODERATOR_ACCESS_TOKEN = moderator_token or None
    except CheckFailure as error:
        print(str(error), file=sys.stderr)
        return 1
    primary_error: str | None = None
    try:
        run()
        print("All ASP.NET deck-sharing HTTP checks passed.")
    except CheckFailure as error:
        primary_error = str(error)
    except (AssertionError, KeyError, TypeError, ValueError):
        primary_error = "A deck-sharing HTTP check returned an invalid fixture or response."
    finally:
        cleanup_failures = cleanup()
    if primary_error:
        print(f"Deck-sharing HTTP verification failed: {primary_error}", file=sys.stderr)
    if cleanup_failures:
        print("Scoped fixture cleanup did not fully complete: " + ", ".join(cleanup_failures), file=sys.stderr)
    return 1 if primary_error or cleanup_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
