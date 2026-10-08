import { createApp } from "./app.js";
import { config, ensureDirs, BACKUP_DIRS } from "./config.js";
import { prisma } from "./db.js";
import { autoBackupIfDue } from "./backup/service.js";
import { refreshNotifications } from "./services/alerts.js";
import { APP_VERSION } from "../shared/calc.js";
import { applyMigrations, findMigrationsDir } from "./migrate.js";
import { databaseBackup } from "./backup/database-backup.js";
import { stamp } from "./lib/util.js";

/**
 * Bring the database up to date. When the application version changed (an update was installed),
 * a PRE-UPDATE database backup is taken first, while the data still has the previous layout.
 */
export async function prepareDatabase() {
  let previous: string | null = null;
  try {
    previous = (await prisma.setting.findUnique({ where: { key: "local.appVersion" } }))?.value ?? null;
  } catch { /* brand-new database: no tables yet */ }
  if (previous && previous !== APP_VERSION) {
    try {
      await databaseBackup(stamp(), "PRE_UPDATE_DB");
      console.log(`[update] ${previous} -> ${APP_VERSION}: pre-update database backup created`);
    } catch (e) {
      console.error("[update] pre-update backup failed:", (e as Error).message);
    }
  }
  const dir = findMigrationsDir();
  if (dir && process.env.GRL_AUTO_MIGRATE !== "false") {
    const applied = await applyMigrations(dir);
    if (applied.length) console.log(`[database] applied migrations: ${applied.join(", ")}`);
  }
  await prisma.setting.upsert({ where: { key: "local.appVersion" }, update: { value: APP_VERSION }, create: { key: "local.appVersion", value: APP_VERSION } });
}

export async function startServer(port = config.port, host = config.host) {
  ensureDirs();
  await prisma.$connect();
  await prepareDatabase();
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });
  console.log(`G Road Lines ERP ${APP_VERSION} running on http://localhost:${port}`);
  console.log(`Backups: ${BACKUP_DIRS.root}`);

  // Automatic daily Excel backup: shortly after start (the ERP was opened) and then checked every hour.
  const tick = async () => {
    try {
      const r = await autoBackupIfDue();
      if (r) console.log(`[backup] automatic backup ${r.fileName} (${r.totalRecords} records, verified)`);
    } catch (e) {
      console.error("[backup] automatic backup failed:", (e as Error).message);
    }
    try { await refreshNotifications(); } catch (e) { console.error("[alerts]", (e as Error).message); }
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 60 * 60_000).unref();
  return server;
}

const isMain = process.argv[1] && /index\.(ts|js)$/.test(process.argv[1]) && !process.env.GRL_EMBEDDED;
if (isMain) {
  startServer().catch((e) => {
    console.error("Could not start the ERP:", e);
    process.exit(1);
  });
}
