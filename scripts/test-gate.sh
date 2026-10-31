#!/usr/bin/env bash
#
# Serialize full Jest gates on a shared host.
#
# The client and server suites are CPU-heavy. Running them concurrently (or
# running the same gate from multiple worktrees) oversubscribes a 6-core host
# and makes otherwise-fast wizard tests miss their per-test budget. This wrapper
# holds one cross-checkout lock for the whole gate and runs the suites in a
# fixed order.
#
# Usage:
#   scripts/test-gate.sh            # server then client
#   scripts/test-gate.sh client     # client only
#   scripts/test-gate.sh server     # server only
#
# @see docs/TESTING_STRATEGY.md §Test Performance & Run Guidance
# @see docs/TEST_GIT_GUIDE.md §Full gate on a shared host

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"
LOCK_FILE="${TMPDIR:-/tmp}/webdav-easyaccess-full-tests.lock"
LOCK_TIMEOUT="${TEST_GATE_LOCK_TIMEOUT:-3600}"

case "$TARGET" in
  all | client | server) ;;
  *)
    echo "Usage: $0 [all|client|server]" >&2
    exit 2
    ;;
esac

exec 9>"$LOCK_FILE"
if ! flock -w "$LOCK_TIMEOUT" 9; then
  echo "Another full test gate is still running (lock: $LOCK_FILE)." >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ "$TARGET" == "all" || "$TARGET" == "server" ]]; then
  echo "[test-gate] server test:ci"
  npm run test:ci --workspace server
fi

if [[ "$TARGET" == "all" || "$TARGET" == "client" ]]; then
  echo "[test-gate] client test:ci"
  npm run test:ci --workspace client
fi
