#!/usr/bin/env python3
"""Start an isolated Development API, verify its HTTP contracts, and always stop it.

Build Release first. --publishing also needs the three explicit local Supabase
RECALL_INTEGRATION_* settings and runs the account-scoped publishing verifier.
"""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def run_checks(checks, root, environment):
    for script, *arguments in checks:
        command = [sys.executable, str(root / "backend/scripts" / script), *arguments]
        result = subprocess.run(command, cwd=root, env=environment, check=False, timeout=300)
        if result.returncode != 0:
            return result.returncode
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publishing", action="store_true")
    parser.add_argument("--port", type=int, default=5019)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    origin = f"http://127.0.0.1:{args.port}"
    environment = dict(os.environ, ASPNETCORE_ENVIRONMENT="Development", API_RATE_LIMIT_MODE="memory")
    if args.publishing:
        for suffix in ("URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"):
            value = environment.get(f"RECALL_INTEGRATION_SUPABASE_{suffix}")
            if not value:
                print(f"Set RECALL_INTEGRATION_SUPABASE_{suffix} explicitly.", file=sys.stderr)
                return 1
            environment[f"SUPABASE_{suffix}"] = value
        environment["RECALL_INTEGRATION_API_URL"] = origin
    command = ["dotnet", "run", "--project", "backend/Recall.Api", "--configuration", "Release",
               "--no-build", "--no-launch-profile", "--urls", origin]
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(command, cwd=root, env=environment, stdout=log, stderr=log)
        try:
            ready = False
            for _ in range(120):
                if process.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(f"{origin}/health", timeout=1) as response:
                        ready = response.status == 200
                except (urllib.error.URLError, TimeoutError):
                    pass
                if ready:
                    break
                time.sleep(0.5)
            if not ready or process.poll() is not None:
                log.seek(0)
                print(log.read(), file=sys.stderr)
                print("Development API did not become ready.", file=sys.stderr)
                return 1
            checks = [["verify-openapi.py", f"{origin}/swagger/v1/swagger.json"]]
            if args.publishing:
                checks.append(["verify-deck-sharing.py"])
            return run_checks(checks, root, environment)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"API verification could not complete: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
