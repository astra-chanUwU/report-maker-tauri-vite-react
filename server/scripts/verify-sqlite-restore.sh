#!/usr/bin/env bash
set -euo pipefail
BACKUP="${1:?backup file required}"
command -v sqlite3 >/dev/null || { echo "sqlite3 required" >&2; exit 1; }
[[ -f "$BACKUP" ]] || { echo "backup not found: $BACKUP" >&2; exit 1; }
TMP="$(mktemp -t report-maker-restore-XXXXXX.db)"
trap 'rm -f "$TMP"' EXIT
cp -- "$BACKUP" "$TMP"
[[ "$(sqlite3 "$TMP" 'PRAGMA integrity_check;')" == "ok" ]] || { echo "integrity_check failed" >&2; exit 1; }
echo "restore verification ok"
