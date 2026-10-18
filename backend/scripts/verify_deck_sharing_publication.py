"""Publication, discovery, and following checks for the deck-sharing verifier."""

from __future__ import annotations

import urllib.parse
import uuid
from typing import Any, Callable

from verify_deck_sharing_http import checked, require


def verify_publication_and_following(
    api: Callable[..., tuple[int, Any]],
    *,
    owner_id: str,
    owner_token: str,
    viewer_token: str,
    document: dict[str, Any],
    area_id: str,
    card_id: str,
    activity_id: str,
    unknown_activity_id: str,
    area_ids: list[str],
    publication_ids: list[str],
) -> tuple[str, str, dict[str, Any]]:
    authored = checked(
        "Author through ASP.NET workspace",
        api("/api/v1/workspace", "POST", {"schemaVersion": 1, "areas": [
            {"document": document, "color": "#123456", "baseContentHash": None}],
            "tombstones": []}, owner_token),
        (200,),
    )
    require(isinstance(authored, dict), "Workspace write response was invalid.")
    snapshot = checked(
        "Read authored workspace through ASP.NET",
        api("/api/v1/workspace", token=owner_token),
        (200,),
    )
    require(
        isinstance(snapshot, dict)
        and snapshot.get("ownerId") == owner_id
        and any(
            isinstance(area, dict)
            and isinstance(area.get("document"), dict)
            and area["document"].get("id") == area_id
            for area in snapshot.get("areas", [])
        ),
        "Workspace snapshot did not include the authenticated owner's authored area.",
    )
    exported = checked(
        "Export account without a profile row",
        api("/api/v1/account/export", token=owner_token),
        (200,),
    )
    require(
        isinstance(exported, dict)
        and isinstance(exported.get("account"), dict)
        and exported["account"].get("userId") == owner_id
        and exported["account"].get("profile") is None,
        "Account export must support an owner without a profile row.",
    )
    publication_operation_id = str(uuid.uuid4())
    publication_request = {
        "schemaVersion": 1,
        "operationId": publication_operation_id,
        "sourceAreaId": area_id,
        "content": document,
        "visibility": "public",
        "license": "CC0-1.0",
        "attribution": None,
        "reuseConfirmed": True,
    }
    published = checked(
        "Publish through ASP.NET",
        api("/api/v1/knowledge-areas", "POST", publication_request, owner_token),
        (200, 201),
    )
    require(isinstance(published, dict) and isinstance(published.get("version"), dict),
            "Publication response did not include its immutable version.")
    version_id = str(uuid.UUID(published["version"].get("id", "")))
    publication_ids.append(version_id)
    replay = checked(
        "Replay publication operation",
        api("/api/v1/knowledge-areas", "POST", publication_request, owner_token),
        (200,),
    )
    require(isinstance(replay, dict) and isinstance(replay.get("version"), dict)
            and replay["version"].get("id") == version_id,
            "Publication replay did not return the original immutable version.")
    changed_operation = {**publication_request, "visibility": "private"}
    checked(
        "Reject conflicting publication operation reuse",
        api("/api/v1/knowledge-areas", "POST", changed_operation, owner_token),
        (409,),
    )

    discovery = checked("Public discovery", api("/api/v1/decks?q=Deck%20sharing%20HTTP"), (200,))
    require(isinstance(discovery, dict), "Public discovery response was invalid.")
    catalog_deck = next(
        (deck for deck in discovery.get("decks", []) if isinstance(deck, dict) and deck.get("id") == area_id),
        None,
    )
    require(catalog_deck is not None, "Public discovery omitted the fixture deck.")
    require("ownerId" not in catalog_deck and "owner_id" not in catalog_deck,
            "Public discovery disclosed owner identity.")
    filtered_catalog = checked(
        "Filtered catalog and derived preview",
        api("/api/v1/decks?" + urllib.parse.urlencode({
            "q": "Deck sharing HTTP fixture", "language": "EN", "tag": "INTEGRATION",
            "difficulty": "BEGINNER", "activityType": "recall.basic",
            "minMinutes": 7, "maxMinutes": 7,
        })),
        (200,),
    )
    filtered_deck = next(
        (deck for deck in filtered_catalog.get("decks", []) if isinstance(deck, dict) and deck.get("id") == area_id),
        None,
    )
    require(filtered_deck is not None, "Public discovery filters omitted a matching deck.")
    catalog = filtered_deck.get("catalog")
    require(isinstance(catalog, dict) and catalog.get("difficulty") == "beginner"
            and catalog.get("cardTypes") == ["basic"]
            and set(catalog.get("activityTypes", [])) == {"recall.basic", "community.diagram"}
            and catalog.get("estimatedMinutes") == 7,
            "Catalog facets were not derived from the published definitions.")
    previews = catalog.get("preview")
    require(isinstance(previews, list) and previews and previews[0] == {
        "kind": "basic", "prompt": "Fixture question", "answer": "Fixture answer",
    }, "Catalog preview did not represent the published card content.")
    require(any(isinstance(item, dict) and item.get("kind") == "activity"
                and item.get("prompt") == "Fixture built-in activity" for item in previews),
            "Catalog preview omitted a published learning activity.")
    no_match = checked(
        "Difficulty filter excludes non-matching deck",
        api("/api/v1/decks?" + urllib.parse.urlencode({
            "q": "Deck sharing HTTP fixture", "difficulty": "advanced",
        })),
        (200,),
    )
    require(isinstance(no_match, dict) and all(
        not isinstance(deck, dict) or deck.get("id") != area_id for deck in no_match.get("decks", [])
    ), "Difficulty filtering returned a non-matching deck.")
    detail = checked("Stable public deck detail", api(f"/api/v1/decks/{area_id}"), (200,))
    require(isinstance(detail, dict) and isinstance(detail.get("deck"), dict)
            and detail["deck"].get("id") == area_id, "Deck detail response identity was invalid.")
    require("ownerId" not in detail["deck"] and "owner_id" not in detail["deck"],
            "Public deck detail disclosed owner identity.")

    checked("Retired named-access GET route", api(f"/api/v1/decks/{area_id}/access", token=owner_token), (404,))
    checked("Retired named-access PUT route", api(f"/api/v1/decks/{area_id}/access", "PUT",
        {"userId": str(uuid.uuid4()), "role": "viewer"}, owner_token), (404,))
    checked("Retired named-access DELETE route", api(f"/api/v1/decks/{area_id}/access/{uuid.uuid4()}",
        "DELETE", token=owner_token), (404,))

    fork = checked(
        "Fork through ASP.NET",
        api(f"/api/v1/published/{version_id}/fork", "POST",
            {"schemaVersion": 1, "operationId": str(uuid.uuid4())}, viewer_token),
        (200,),
    )
    require(isinstance(fork, dict) and isinstance(fork.get("areaId"), str)
            and isinstance(fork.get("document"), dict)
            and fork["document"].get("forkedFromVersionId") == version_id,
            "Fork response did not preserve its source lineage.")
    fork_area_id = str(uuid.UUID(fork["areaId"]))
    area_ids.append(fork_area_id)
    fork_document = fork["document"]
    fork_activities = fork_document.get("activities")
    require(isinstance(fork_activities, list) and len(fork_activities) == 2,
            "Fork did not preserve portable activity definitions.")
    fork_builtin = next((item for item in fork_activities if item.get("pluginId") == "recall.basic"), None)
    fork_unknown = next((item for item in fork_activities if item.get("pluginId") == "community.diagram"), None)
    require(isinstance(fork_builtin, dict) and isinstance(fork_unknown, dict),
            "Fork lost a built-in or unknown plugin definition.")
    fork_objective_id = fork_document["objectives"][0]["id"]
    fork_card_id = fork_document["cards"][0]["id"]
    require(fork_builtin.get("id") != activity_id and fork_builtin.get("areaId") == fork_area_id
            and fork_builtin.get("objectiveIds") == [fork_objective_id]
            and fork_builtin.get("payload", {}).get("cardId") == fork_card_id,
            "Fork did not remap built-in activity identities and card references.")
    require(fork_unknown.get("id") != unknown_activity_id and fork_unknown.get("areaId") == fork_area_id
            and fork_unknown.get("payload") == {"opaque": {"cardId": card_id, "nodes": ["A", True, None, 3]}},
            "Fork did not preserve the opaque unknown-plugin payload.")

    followed = checked(
        "Follow personal fork",
        api("/api/v1/deck-subscriptions", "PUT", {
            "deckId": area_id, "areaId": fork_area_id,
            "versionId": version_id, "following": True,
        }, viewer_token),
        (200,),
    )
    require(isinstance(followed, dict), "Subscription response was invalid.")

    update_request = {
        **publication_request,
        "operationId": str(uuid.uuid4()),
        "releaseNotes": "A public release for the inbox.",
    }
    updated_publication = checked(
        "Publish a later public release",
        api("/api/v1/knowledge-areas", "POST", update_request, owner_token),
        (200, 201),
    )
    require(isinstance(updated_publication, dict) and isinstance(updated_publication.get("version"), dict),
            "Later public release response was invalid.")
    update_version_id = str(uuid.UUID(updated_publication["version"].get("id", "")))
    publication_ids.append(update_version_id)
    updates = checked("Read followed-deck updates", api("/api/v1/deck-subscriptions/updates", token=viewer_token), (200,))
    require(isinstance(updates, dict) and isinstance(updates.get("updates"), list), "Updates inbox response was invalid.")
    update = next((item for item in updates["updates"] if isinstance(item, dict) and item.get("areaId") == fork_area_id), None)
    require(update is not None and update.get("deckId") == area_id and update.get("knownVersionId") == version_id
            and update.get("latestVersionId") == update_version_id and update.get("releaseNotes") == update_request["releaseNotes"]
            and update.get("seen") is False, "Updates inbox omitted or misidentified the later public release.")
    read_updates = checked("Acknowledge followed-deck update", api(
        f"/api/v1/deck-subscriptions/{fork_area_id}/updates/read", "POST",
        {"versionId": update_version_id}, viewer_token), (200,))
    require(isinstance(read_updates, dict) and any(
        isinstance(item, dict) and item.get("areaId") == fork_area_id
        and item.get("latestVersionId") == update_version_id and item.get("seen") is True
        for item in read_updates.get("updates", [])), "Update acknowledgment did not return its read marker.")

    return version_id, update_version_id, publication_request
