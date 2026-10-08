import { createApp } from "./app.js";
import { config, ensureDirs, BACKUP_DIRS } from "./config.js";
import { prisma } from "./db.js";
import { autoBackupIfDue } from "./backup/service.js";
import { refreshNotifications } from "./services/alerts.js";
import { APP_VERSION } from "../shared/calc.js";

export async function startServer(port = config.port, host = config.host) {
  ensureDirs();
  await prisma.$connect();
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
