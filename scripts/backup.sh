#!/usr/bin/env bash
# Back up the PostgreSQL database (custom format) and the uploaded documents.
# Usage: npm run backup            (reads DATABASE_URL / UPLOAD_DIR from the environment or .env)
#        BACKUP_DIR=/mnt/backups KEEP_DAYS=30 npm run backup
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ] && [ -z "${DATABASE_URL:-}" ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_DIR="${UPLOAD_DIR:-./storage/uploads}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
DB_URL="${DATABASE_URL%%\?*}"   # pg_dump does not understand Prisma's ?schema= parameter

echo "Dumping database..."
pg_dump --format=custom --no-owner --no-privileges --file "$BACKUP_DIR/waste_erp_${STAMP}.dump" "$DB_URL"
pg_restore --list "$BACKUP_DIR/waste_erp_${STAMP}.dump" > /dev/null   # verifies the archive is readable

if [ -d "$UPLOAD_DIR" ]; then
  echo "Archiving uploaded documents..."
  tar -czf "$BACKUP_DIR/uploads_${STAMP}.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
fi

# Record the backup time (shown in Settings → System & Backup)
psql "$DB_URL" -qc "INSERT INTO settings (key, value, description, \"updatedAt\") VALUES ('backup.last', '$(date +%s)000', 'Last successful backup', now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \"updatedAt\" = now();" || true

find "$BACKUP_DIR" -name 'waste_erp_*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup complete: $BACKUP_DIR/waste_erp_${STAMP}.dump"
