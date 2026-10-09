#!/usr/bin/env python3
"""Verify important guarantees in the Development Swagger contract.

Run after starting Recall.Api in Development:
  python3 backend/scripts/verify-openapi.py [http://localhost:5000/swagger/v1/swagger.json]
"""

import json
import sys
import urllib.request


url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000/swagger/v1/swagger.json"
with urllib.request.urlopen(url, timeout=10) as response:
    document = json.load(response)

paths = document["paths"]
operations = {
    (path, method): operation
    for path, path_item in paths.items()
    for method, operation in path_item.items()
    if method in {"get", "post", "put", "patch", "delete", "head", "options"}
}
assert len(paths) >= 24, f"expected the complete mapped path inventory, got {len(paths)} paths"
assert ("/api/v1/tutor", "post") in operations
assert ("/api/v1/workspace", "get") in operations
assert ("/api/v1/sync", "get") in operations and ("/api/v1/sync", "post") in operations

for (path, method), operation in operations.items():
    responses = operation.get("responses", {})
    assert "200" in responses or method == "head" or path in {"/auth/sign-out", "/auth/confirm", "/auth/openai", "/auth/openai/callback"}, (path, method, responses)
    if method in {"post", "patch", "delete"} and path != "/auth/sign-out" and path != "/api/internal/tutor-retention":
        content = operation.get("requestBody", {}).get("content", {})
        assert "application/json" in content or "application/octet-stream" in content, (path, method, "missing request body")
    for code in ("400", "401", "403", "404", "409", "413", "415", "422", "429", "502", "503"):
        if code in responses:
            assert "application/json" in responses[code].get("content", {}), (path, method, code, "missing JSON error envelope")
            schema = responses[code]["content"]["application/json"]["schema"]
            if (path, code) == ("/api/v1/auth/session", "502"):
                assert schema.get("required") == ["title", "status"] and schema.get("description", "").startswith("RFC 9457"), schema
            else:
                assert schema.get("required") == ["error"] and schema.get("properties", {}).get("error", {}).get("type") == "string", (path, method, code, schema)

assert "cursor" in {parameter["name"] for parameter in operations[("/api/v1/sync", "get")].get("parameters", [])}
media = operations[("/api/v1/workspace/media/{mediaId}", "get")]["responses"]["200"]["content"]
assert media.get("image/png", {}).get("schema", {}).get("format") == "binary", media
upload = operations[("/api/v1/workspace/media/{mediaId}", "post")]
assert upload.get("requestBody", {}).get("content", {}).get("application/octet-stream", {}).get("schema", {}).get("format") == "binary", upload
assert "x-recall-media-reference" in {parameter["name"] for parameter in upload.get("parameters", [])}, upload
schemes = document.get("components", {}).get("securitySchemes", {})
assert {"Bearer", "SupabaseSessionCookie"} <= schemes.keys(), schemes
assert operations[("/api/v1/tutor", "post")].get("security"), "protected operation is missing auth metadata"
assert not operations[("/api/v1/auth/openai/capabilities", "get")].get("security"), "public capability route should be anonymous"

print(f"OpenAPI contract checks passed: {len(paths)} paths, {len(operations)} operations")
