"""Bounded HTTP transport helpers for the deck-sharing integration verifier."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CheckFailure(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailure(message)


def loopback_origin(name: str) -> str:
    value = os.environ.get(name, "").strip()
    require(bool(value), f"Set {name} to an explicit loopback origin.")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        raise CheckFailure(f"{name} must be a valid loopback HTTP(S) origin.") from None
    require(
        parsed.scheme in ("http", "https")
        and parsed.hostname in ("localhost", "127.0.0.1", "::1")
        and parsed.username is None
        and parsed.password is None
        and parsed.path in ("", "/")
        and parsed.query == ""
        and parsed.fragment == ""
        and (port is None or 1 <= port <= 65535),
        f"{name} must be a loopback HTTP(S) origin without credentials, path, query, or fragment.",
    )
    host = f"[{parsed.hostname}]" if ":" in (parsed.hostname or "") else parsed.hostname
    return f"{parsed.scheme}://{host}" + (f":{port}" if port is not None else "")


def required_secret(name: str) -> str:
    value = os.environ.get(name, "")
    require(bool(value) and value == value.strip(), f"Set {name} explicitly without surrounding whitespace.")
    return value



def request(
    origin: str,
    path: str,
    method: str = "GET",
    body: Any = None,
    token: str | None = None,
    apikey: str | None = None,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if apikey:
        headers["apikey"] = apikey
    req = urllib.request.Request(origin + path, data=payload, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=20) as response:
            raw = response.read(1_048_577)
            require(len(raw) <= 1_048_576, "Integration response exceeded its bound.")
            if not raw:
                return response.status, None
            content_type = response.headers.get("Content-Type", "")
            return response.status, json.loads(raw) if "json" in content_type.lower() else None
    except urllib.error.HTTPError as error:
        raw = error.read(1_048_577)
        require(len(raw) <= 1_048_576, "Integration error response exceeded its bound.")
        content_type = error.headers.get("Content-Type", "")
        try:
            payload_value = json.loads(raw) if "json" in content_type.lower() and raw else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload_value = None
        return error.code, payload_value
    except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
        raise CheckFailure("Integration request could not complete or returned invalid JSON.") from None


def checked(label: str, result: tuple[int, Any], statuses: tuple[int, ...]) -> Any:
    status, body = result
    print(f"{label}: HTTP {status}")
    require(status in statuses, f"{label} returned an unexpected HTTP status.")
    return body


