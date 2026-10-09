/**
 * GRL ERP - Windows desktop application (Electron).
 * Runs the ERP server inside the app and shows it in a window. Phones on the same Wi-Fi
 * can use the same ERP at http://<this computer's IP>:<port>.
 * Data:    PostgreSQL (installed separately)
 * Backups: Documents\G Road Lines ERP\Backup  (outside the program folder, survives updates/uninstall)
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const VERSION = app.getVersion();
const userData = app.getPath("userData");
const configFile = path.join(userData, "config.json");
const grlHome = path.join(app.getPath("documents"), "G Road Lines ERP");
const backupRoot = path.join(grlHome, "Backup");
// packaged without asar (see package.json), so the embedded server resolves its node_modules normally
const res = (...p) => path.join(__dirname, ...p);

let win = null;
let server = null;
let serverModule = null;
let config = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { return null; }
}
function writeConfig(c) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { mode: 0o600 });
}
function dbUrl(c, database = c.database) {
  return `postgresql://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${encodeURIComponent(database)}`;
}

function setEnv(c) {
  process.env.DATABASE_URL = c.databaseUrl;
  process.env.AUTH_SECRET = c.authSecret;
  process.env.PORT = String(c.appPort || 4000);
  process.env.HOST = "0.0.0.0";
  process.env.GRL_HOME = grlHome;
  process.env.BACKUP_ROOT = backupRoot;
  process.env.GRL_MIGRATIONS_DIR = res("prisma", "migrations");
  process.env.GRL_EMBEDDED = "1";
  process.env.NODE_ENV = "production";
}

async function startErp() {
  setEnv(config);
  serverModule = await import(pathToFileURL(res("server-dist", "server", "index.js")).href);
  server = await serverModule.startServer(Number(config.appPort || 4000), "0.0.0.0");
}

async function withPrisma(url, fn) {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url });
  try { return await fn(db); } finally { await db.$disconnect(); }
}

ipcMain.handle("grl:setup-info", () => ({ backupDir: backupRoot, version: VERSION }));
ipcMain.handle("grl:setup-test", async (_e, c) => {
  try {
    await withPrisma(dbUrl(c, "postgres"), (db) => db.$queryRawUnsafe("SELECT 1"));
    return { ok: true, message: "Connected to PostgreSQL." };
  } catch (e) {
    return { ok: false, message: `Cannot connect: ${String(e.message).split("\n").slice(-2).join(" ")}` };
  }
});
ipcMain.handle("grl:setup-save", async (_e, c) => {
  try {
    if (!/^[A-Za-z0-9_]+$/.test(c.database)) return { ok: false, message: "Database name: letters, numbers and _ only." };
    await withPrisma(dbUrl(c, "postgres"), async (db) => {
      const exists = await db.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, c.database);
      if (!exists.length) await db.$executeRawUnsafe(`CREATE DATABASE "${c.database}"`);
    });
    config = { databaseUrl: dbUrl(c), authSecret: crypto.randomBytes(48).toString("hex"), appPort: Number(c.appPort) || 4000, createdAt: new Date().toISOString() };
    writeConfig(config);
    await startErp();
    win.loadURL(`http://localhost:${config.appPort}/`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e.message) };
  }
});
ipcMain.handle("grl:backup-dir", () => backupRoot);
ipcMain.handle("grl:open-path", async (_e, which) => {
  const dir = which === "database" ? path.join(backupRoot, "Database") : which === "excel" ? path.join(backupRoot, "Excel") : backupRoot;
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return dir;
});

async function about() {
  let lic = "unknown";
  try {
    const l = await import(pathToFileURL(res("server-dist", "server", "license.js")).href);
    const s = await l.currentLicense();
    lic = `${s.plan} - ${s.level}${s.expiryDate ? ` (expires ${s.expiryDate})` : ""}\nMachine ID: ${s.machineId}`;
  } catch { /* not started yet */ }
  dialog.showMessageBox(win, { type: "info", title: "About GRL ERP", message: `GRL ERP\nVersion ${VERSION}`, detail: `G Road Lines - Transport Agent ERP\nLicense Status: ${lic}\n\nBackups: ${backupRoot}` });
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Open Backup Folder", click: () => { fs.mkdirSync(backupRoot, { recursive: true }); shell.openPath(backupRoot); } },
      { label: "Backup && Restore", click: () => win && config && win.loadURL(`http://localhost:${config.appPort}/backup`) },
      { type: "separator" }, { role: "quit" },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [
      { label: "Database settings (reconnect)", click: async () => {
        const r = await dialog.showMessageBox(win, { type: "warning", buttons: ["Cancel", "Change"], message: "Change the database connection?", detail: "Your data is not deleted. The ERP will restart and ask for the PostgreSQL details." });
        if (r.response === 1) { fs.rmSync(configFile, { force: true }); app.relaunch(); app.exit(0); }
      } },
      { label: "About GRL ERP", click: about },
    ] },
  ]));
}

app.whenReady().then(async () => {
  menu();
  win = new BrowserWindow({
    width: 1366, height: 860, title: `GRL ERP ${VERSION}`, icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  config = readConfig();
  if (!config) return win.loadFile(path.join(__dirname, "setup.html"));
  try {
    await startErp();
    win.loadURL(`http://localhost:${config.appPort}/`);
  } catch (e) {
    const r = await dialog.showMessageBox(win, {
      type: "error", buttons: ["Quit", "Database settings"], title: "GRL ERP could not start",
      message: "The ERP could not connect to its database.", detail: `${e.message}\n\nCheck that PostgreSQL is running (Windows Services -> postgresql). Your data and backups are safe.`,
    });
    if (r.response === 1) { win.loadFile(path.join(__dirname, "setup.html")); return; }
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { try { server && server.close(); } catch { /* ignore */ } });
