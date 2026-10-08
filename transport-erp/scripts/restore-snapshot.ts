/**
 * Restore a JSON database snapshot (Backup/Database/GRL_DB_SNAPSHOT_*.json.gz). Replaces ALL tables, including users.
 *   npx tsx scripts/restore-snapshot.ts <file> --yes
 */
import { restoreSnapshot } from "../src/server/backup/database-backup.js";
import { prisma } from "../src/server/db.js";

const file = process.argv[2];
if (!file || !process.argv.includes("--yes")) {
  console.error("Usage: npx tsx scripts/restore-snapshot.ts <GRL_DB_SNAPSHOT_....json.gz> --yes\nThis REPLACES every table in the database configured in .env.");
  process.exit(1);
}
await restoreSnapshot(file);
console.log("Snapshot restored.");
await prisma.$disconnect();
