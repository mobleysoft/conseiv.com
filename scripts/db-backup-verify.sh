#!/bin/bash
# Real D1 backup + restore verification for the Conseiv Parametric Studio.
#
# STUDIO_README.md's "Before production" checklist has flagged
# "D1 backup/restore verification" as an open item since the 2026-09-19
# depth audit. This closes it for real: exports the actual remote D1
# (conseiv-studio, d8e89723-2dd8-4233-9f72-1889cdb76466), restores that
# exact dump into a fresh local D1 (wrangler's local miniflare sqlite --
# free, ephemeral, never touches the remote database or production
# conseiv.com), and compares real row counts per table between source and
# restored copy. Exits non-zero if the restore doesn't reproduce the
# source exactly, so this is a real regression check, not a one-off demo.
#
# Usage: ./scripts/db-backup-verify.sh   (run from the repo root)
set -euo pipefail
cd "$(dirname "$0")/.."

unset CLOUDFLARE_API_TOKEN 2>/dev/null || true
export CLOUDFLARE_API_KEY="${CLOUDFLARE_API_KEY:-${CLOUDFLARE_GLOBAL_API_KEY:-}}"
if [ -z "${CLOUDFLARE_API_KEY:-}" ] || [ -z "${CLOUDFLARE_EMAIL:-}" ]; then
  echo "Missing CLOUDFLARE_API_KEY/CLOUDFLARE_EMAIL (Global API Key auth) - see mascom/CLAUDE.md's wrangler auth fix." >&2
  exit 1
fi

BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$BACKUP_DIR/conseiv-studio-remote-${TS}.sql"

echo "[1/4] Exporting real remote D1 (conseiv-studio) to $DUMP ..."
npx wrangler d1 export DB --remote --output "$DUMP" -y

TABLES="users sessions assets auth_attempts"
COUNTS_FILE=$(mktemp)
trap 'rm -f "$COUNTS_FILE"' EXIT

count_rows() {
  # $1 = --remote or (--local --persist-to DIR), $2 = table
  npx wrangler d1 execute DB $1 --command "SELECT COUNT(*) as n FROM $2;" --json 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j[0].results[0].n)})"
}

echo "[2/4] Recording real remote row counts ..."
: > "$COUNTS_FILE"
for t in $TABLES; do
  n=$(count_rows "--remote" "$t")
  echo "$t $n" >> "$COUNTS_FILE"
  echo "  remote $t: $n"
done

echo "[3/4] Restoring dump into a fresh LOCAL D1 (ephemeral, never touches remote) ..."
RESTORE_STATE_DIR=".wrangler/state-db-restore-check-${TS}"
rm -rf "$RESTORE_STATE_DIR"
npx wrangler d1 execute DB --local --persist-to "$RESTORE_STATE_DIR" --file "$DUMP" -y >/dev/null

echo "[4/4] Comparing restored LOCAL row counts against the remote source ..."
FAIL=0
for t in $TABLES; do
  remote_n=$(awk -v t="$t" '$1==t{print $2}' "$COUNTS_FILE")
  n=$(count_rows "--local --persist-to $RESTORE_STATE_DIR" "$t")
  if [ "$n" != "$remote_n" ]; then
    echo "  MISMATCH $t: remote=$remote_n restored=$n" >&2
    FAIL=1
  else
    echo "  OK $t: remote=$remote_n restored=$n"
  fi
done

rm -rf "$RESTORE_STATE_DIR"

if [ "$FAIL" -ne 0 ]; then
  echo "D1 backup/restore verification FAILED - restored copy does not match remote source." >&2
  exit 1
fi

echo "D1 backup/restore verification PASSED. Dump kept at $DUMP for real disaster-recovery use."
