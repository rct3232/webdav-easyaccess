#!/usr/bin/env bash
#
# Serialize the full local gate on a shared host: static checks, then the
# server and client Jest suites in a fixed order. The Playwright release matrix
# is a separate stage (`gate:full`) because it needs Docker, browsers, and model
# weights.
#
# The client and server suites are CPU-heavy. Running them concurrently (or
# running the same gate from multiple worktrees) oversubscribes a 6-core host
# and makes otherwise-fast wizard tests miss their per-test budget. This wrapper
# holds one cross-checkout lock for the whole gate.
#
# Usage:
#   npm run gate
#
# @see docs/TESTING_STRATEGY.md
# @see docs/TEST_GIT_GUIDE.md

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="${TMPDIR:-/tmp}/webdav-easyaccess-gate.lock"
LOCK_TIMEOUT="${GATE_LOCK_TIMEOUT:-3600}"

exec 9>"$LOCK_FILE"
if ! flock -w "$LOCK_TIMEOUT" 9; then
  echo "Another gate is still running (lock: $LOCK_FILE)." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[gate] check"
npm run check

echo "[gate] test"
npm run test
