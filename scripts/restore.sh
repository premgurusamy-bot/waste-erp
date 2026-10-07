#!/usr/bin/env bash
# Restore a database dump created by scripts/backup.sh.
# Usage: npm run restore -- backups/waste_erp_YYYYMMDD_HHMMSS.dump [backups/uploads_YYYYMMDD_HHMMSS.tar.gz]
# WARNING: replaces the contents of the database in DATABASE_URL. Stop the application first.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ] && [ -z "${DATABASE_URL:-}" ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
DUMP="${1:?Give the .dump file to restore}"
UPLOADS="${2:-}"
DB_URL="${DATABASE_URL%%\?*}"
echo "This will REPLACE all data in: ${DB_URL##*@}"
read -r -p "Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --dbname "$DB_URL" "$DUMP"
if [ -n "$UPLOADS" ]; then
  UPLOAD_DIR="${UPLOAD_DIR:-./storage/uploads}"
  mkdir -p "$(dirname "$UPLOAD_DIR")"
  tar -xzf "$UPLOADS" -C "$(dirname "$UPLOAD_DIR")"
fi
echo "Restore complete. Run 'npx prisma migrate deploy' if the backup is from an older version."
