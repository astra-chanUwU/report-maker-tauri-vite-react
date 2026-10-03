#!/usr/bin/env bash
set -euo pipefail
DB_PATH="${1:-${REPORT_DB_PATH:-/var/lib/report-maker/report-maker.db}}"
BACKUP_DIR="${2:-/var/backups/report-maker}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/report-maker-${STAMP}.db"
command -v sqlite3 >/dev/null || { echo "sqlite3 required" >&2; exit 1; }
[[ -f "$DB_PATH" ]] || { echo "database not found: $DB_PATH" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '${DEST}'"
sha256sum "$DEST" > "${DEST}.sha256"
echo "backup written: $DEST"
