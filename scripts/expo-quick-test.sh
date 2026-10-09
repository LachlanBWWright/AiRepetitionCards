#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Usage: ./scripts/expo-quick-test.sh

Starts Expo through a public tunnel and prints a QR code for Expo Go. This works
when the development machine is behind a container, VPN, or network that your
phone cannot reach directly. No Android SDK or native build is needed.
HELP
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  echo "This script takes no mode arguments. Run it without arguments or use --help." >&2
  exit 2
fi

cd "$repo_root"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install the package manager declared in package.json." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Expo." >&2
  exit 1
fi

if [[ ! -x "$repo_root/apps/mobile/node_modules/.bin/expo" || \
  ! -e "$repo_root/apps/mobile/node_modules/expo-constants" || \
  ! -e "$repo_root/apps/mobile/node_modules/@expo/ui" ]]; then
  echo "Installing workspace dependencies..."
  pnpm install --frozen-lockfile
fi

exec pnpm --filter mobile exec expo start --go --tunnel --clear
