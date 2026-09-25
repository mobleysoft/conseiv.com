#!/bin/bash
# Scheduled (not just on-demand) wrapper around db-backup-verify.sh.
#
# STUDIO_README.md's "Before production" checklist flagged D1 backup/restore
# as "real and live-verified... It is not scheduled anywhere yet - run it by
# hand before any production migration until a real backup cadence is
# decided." This closes that gap: invoked by launchd
# (com.mobcorp.conseiv-backup-verify.plist, daily - an engineering default,
# not a claim that a production cadence has been formally decided; trivial
# to change via the plist's StartInterval once it is). Same lock-file /
# state-file / logging pattern as this portfolio's other launchd wrappers
# (see mascom/run_cf_route_audit.sh).
#
# This does NOT decide launch scope, pricing, or replace the existing
# on-demand `npm run db:backup-verify` entry point - both stay available.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

LOCKFILE=".backup_verify_cron.lock"
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[conseiv-backup-verify] $(date -u +%Y-%m-%dT%H:%M:%SZ) previous run (pid $OLD_PID) still active - skipping this fire" >> mascom_backup_verify_launchd.log
    exit 0
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

source /Users/johnmobley/mascom/cf_keychain_creds.sh

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p logs
LOGFILE="logs/backup_verify_${TS//:/-}.log"

if bash scripts/db-backup-verify.sh >"$LOGFILE" 2>&1; then
  RESULT="pass"
  echo "[conseiv-backup-verify] $TS PASS - see $LOGFILE"
else
  RESULT="fail"
  echo "[conseiv-backup-verify] $TS FAIL - see $LOGFILE" >&2
  bash scripts/backup-verify-alert.sh "D1 backup/restore verification failed at $TS - see $LOGFILE" || true
fi

# Retain only the 14 most recent backup dumps (backups/ is gitignored,
# real disk data, not source - unbounded daily accumulation is a real
# resource leak on a scheduled job, not a hypothetical one).
if [ -d backups ]; then
  ls -1t backups/conseiv-studio-remote-*.sql 2>/dev/null | tail -n +15 | xargs -I{} rm -f "{}"
fi

# Real, checkable run-history state - same pattern as this portfolio's
# other recurring-loop state files (cf_route_audit_state.json etc.),
# scoped to this one script rather than a shared file.
STATE_FILE="backup_verify_state.json"
python3 - "$STATE_FILE" "$TS" "$RESULT" "$LOGFILE" <<'PYEOF'
import json, sys, os

state_file, ts, result, logfile = sys.argv[1:5]
if os.path.exists(state_file):
    with open(state_file) as f:
        state = json.load(f)
else:
    state = {"_meta": "Real run history for scripts/run-backup-verify-scheduled.sh (launchd com.mobcorp.conseiv-backup-verify). Not committed - local run state.", "runs": []}

state["last_run_at"] = ts
state["last_run_result"] = result
state["runs"].append({"at": ts, "result": result, "log": logfile})
state["runs"] = state["runs"][-30:]

with open(state_file, "w") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
PYEOF

if [ "$RESULT" = "fail" ]; then
  exit 1
fi
