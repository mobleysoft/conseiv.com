#!/bin/bash
# Real, durable failure alert for scripts/run-backup-verify-scheduled.sh.
#
# STUDIO_README's "Before production" checklist named this gap explicitly:
# a failed backup-verify run only ever surfaced in backup_verify_state.json
# and the launchd stderr log - both silent unless someone goes looking. This
# adds two real signals instead: an always-durable append-only log entry
# (works whether or not anyone is logged into the Mac's GUI when the failure
# happens), plus a best-effort native macOS notification (works only in an
# interactive GUI session - degrades silently, not loudly, when run headless,
# which is honest given this fires via a LaunchAgent that may run before
# login). No third-party service, no cost, no new credential.
#
# Usage: scripts/backup-verify-alert.sh "<message>"
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:?usage: backup-verify-alert.sh <message>}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p logs
echo "$TS $MSG" >> logs/backup_verify_failures.log

if command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$MSG\" with title \"Conseiv backup verify FAILED\"" >/dev/null 2>&1 || true
fi
