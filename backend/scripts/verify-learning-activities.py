#!/usr/bin/env python3
"""HTTP boundary checks for the ASP.NET learning API.

Requires RECALL_TEST_API_URL, RECALL_TEST_ACCESS_TOKEN, and an account that owns at least one
active AI-assessed activity. Run against a development API with OPENAI_API_KEY unset so the
provider-disabled case cannot make a billable request.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


class RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise urllib.error.HTTPError(request.full_url, code, "redirect rejected", headers, None)


def validate_api_url():
    parsed = urllib.parse.urlsplit(os.environ["RECALL_TEST_API_URL"])
    if (
        parsed.scheme not in ("http", "https")
        or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise AssertionError("RECALL_TEST_API_URL must be a loopback URL without credentials/query/fragment.")


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect())


def call(path, method="GET", body=None, owner=None):
    headers = {"Authorization": f"Bearer {os.environ['RECALL_TEST_ACCESS_TOKEN']}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if owner is not None:
        headers["x-recall-owner"] = owner
    request = urllib.request.Request(
        os.environ["RECALL_TEST_API_URL"].rstrip("/") + path,
        method=method,
        headers=headers,
        data=None if body is None else json.dumps(body).encode(),
    )
    try:
        with OPENER.open(request, timeout=20) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        payload = error.read()
        return error.code, json.loads(payload) if payload else {}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    for name in ("RECALL_TEST_API_URL", "RECALL_TEST_ACCESS_TOKEN"):
        require(bool(os.environ.get(name)), f"Set {name} to run authenticated HTTP checks.")
    validate_api_url()

    status, snapshot = call("/api/v1/activities")
    require(status == 200, f"Activity snapshot read returned HTTP {status}: {snapshot}")
    require(
        isinstance(snapshot, dict)
        and isinstance(snapshot.get("revision"), int)
        and isinstance(snapshot.get("library"), dict),
        "GET /api/v1/activities must return a revisioned library.",
    )

    status, body = call("/api/v1/activities", owner="00000000-0000-4000-8000-000000000000")
    require(status == 401, f"A mismatched owner header must return 401; got {status}: {body}")

    invalid_library = dict(snapshot["library"])
    invalid_library["attempts"] = [*invalid_library.get("attempts", []), {"id": "invalid-test-attempt"}]
    status, body = call(
        "/api/v1/activities",
        "POST",
        {"revision": snapshot["revision"], "library": invalid_library},
    )
    require(status == 400, f"An invalid attempt must fail schema validation with 400; got {status}: {body}")

    activities = snapshot["library"].get("activities", [])
    activity = next(
        (
            item
            for item in activities
            if item.get("pluginId") in {
                "recall.short-answer",
                "recall.interrogation",
                "recall.basic",
                "recall.cloze",
            }
            and not item.get("archived", False)
            and isinstance(item.get("payload", {}).get("prompts"), list)
            and isinstance(item.get("payload", {}).get("rubric"), str)
            and item["payload"].get("rubric", "").strip()
            and isinstance(item.get("payload", {}).get("reference"), str)
        ),
        None,
    )
    require(activity is not None, "The fixture account needs an active rubric activity with approved prompts.")
    prompts = activity["payload"]["prompts"]
    request = {
        "activity": activity,
        "response": {
            "presentedPrompts": ["Modified prompt outside the stored activity.", *activity["payload"]["prompts"][1:]],
            "answers": ["Boundary test answer."] * len(activity["payload"]["prompts"]),
            "selectedOptionIds": [],
            "selfScore": 0.5,
            "assistance": "none",
        },
    }
    status, body = call("/api/v1/activities/assess", "POST", request)
    require(status == 400, f"A changed prompt must be rejected before assessment; got {status}: {body}")

    request["response"]["presentedPrompts"] = prompts
    request["response"]["answers"] = ["Boundary test answer."] * len(prompts)
    status, body = call("/api/v1/activities/assess", "POST", request)
    require(
        status == 503 and body.get("error") == "ai-assessment-unavailable",
        "With OPENAI_API_KEY unset, a valid assessment must fail closed as provider unavailable "
        f"(HTTP 503); got {status}: {body}",
    )
    print("Learning activity HTTP boundaries passed: snapshot, owner, attempt schema, canonical prompt, disabled provider.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, KeyError, json.JSONDecodeError, urllib.error.URLError) as error:
        print(f"Learning activity HTTP verification failed: {error}", file=sys.stderr)
        sys.exit(1)
