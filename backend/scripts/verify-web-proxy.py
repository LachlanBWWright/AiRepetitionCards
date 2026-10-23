#!/usr/bin/env python3
"""Check proxy authentication and reject spoofed origins against the local API."""

import os
import sys
import urllib.error
import urllib.request

from verify_deck_sharing_http import loopback_origin, required_secret


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    origin = loopback_origin("RECALL_INTEGRATION_API_URL")
    web = required_secret("RECALL_WEB_ORIGIN")
    secret = required_secret("RECALL_PROXY_SECRET")
    opener = urllib.request.build_opener(NoRedirect())
    checks = [
        ("/health", "GET", {}, 200),
        ("/health", "GET", {"x-recall-proxy-key": "invalid"}, 403),
        ("/health", "GET", {"x-recall-proxy-key": secret}, 200),
        ("/auth/sign-out", "POST", {"x-recall-proxy-key": secret, "Origin": web}, 303),
        ("/auth/sign-out", "POST", {"x-recall-proxy-key": secret,
            "Origin": "https://untrusted.example"}, 403),
        ("/auth/sign-out", "POST", {"Origin": web,
            "X-Forwarded-Host": web.split("://", 1)[1], "X-Forwarded-Proto": "https"}, 403),
    ]
    for path, method, headers, expected in checks:
        request = urllib.request.Request(origin + path, method=method, headers=headers)
        try:
            with opener.open(request, timeout=10) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        except (urllib.error.URLError, TimeoutError):
            print("Proxy acceptance could not reach the local API.", file=sys.stderr)
            return 1
        if status != expected:
            print(f"Proxy acceptance failed: {method} {path}: {status}, expected {expected}.", file=sys.stderr)
            return 1
    print("Web proxy authentication and forged-origin checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
