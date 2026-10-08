import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { config, BACKUP_DIRS } from "./config.js";
import { AppError, badRequest, forbidden } from "./lib/errors.js";
import { COOKIE, login, requireAuth, requirePerm, sessionMiddleware, setSessionCookie, signSession, hashPassword, passwordProblem } from "./auth.js";
import { ctxOf } from "./context.js";
import { audit } from "./audit.js";
import { currentLicense } from "./license.js";
import { APP_VERSION } from "../shared/calc.js";
import { PERMISSIONS } from "../shared/permissions.js";
import * as masters from "./services/masters.js";
import * as trips from "./services/trips.js";
import * as expenses from "./services/expenses.js";
import * as billing from "./services/billing.js";
import * as settlements from "./services/settlements.js";
import * as analytics from "./services/analytics.js";
import * as reports from "./services/reports.js";
import * as documents from "./services/documents.js";
import * as alerts from "./services/alerts.js";
import * as admin from "./services/admin.js";
import * as settings from "./services/settings.js";
import * as backup from "./backup/service.js";
import * as restoreSvc from "./backup/restore-service.js";
import { reportCsv, reportPdf, reportXlsx } from "./lib/export.js";
import { invoicePdf } from "./lib/invoice-pdf.js";
import { SHEETS, type SheetKey } from "./backup/sheets.js";
import { writeImportTemplate } from "./backup/template.js";
import * as gdrive from "./gdrive/drive.js";
import * as gsync from "./gdrive/sync.js";
import { readAnyFile, IMPORT_EXTENSIONS } from "./import/parse.js";
import { importFields, suggestMapping, IMPORT_TARGETS } from "./import/targets.js";
import { prepareImport } from "./import/convert.js";
import { exportData, datasets, EXPORT_FORMATS, type ExportFormat } from "./export/data-export.js";

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
const restoreUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024, files: 1 } });

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { "img-src": ["'self'", "data:", "blob:"], "style-src": ["'self'", "'unsafe-inline'"], "script-src": ["'self'"], "connect-src": ["'self'"], "upgrade-insecure-requests": null },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure,
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false }));
  // CSRF: state-changing API calls must come from our own pages (custom header + same origin)
  api.use((req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.get("x-requested-with") !== "GRL") return next(forbidden("Request blocked (missing security header)."));
    const origin = req.get("origin");
    if (origin) {
      try { if (new URL(origin).host !== req.get("host")) return next(forbidden("Request blocked (cross-site).")); } catch { return next(forbidden("Request blocked.")); }
    }
    next();
  });
  api.use(sessionMiddleware);

  // ------------------------------------------------ public
  api.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, app: "G Road Lines ERP", version: APP_VERSION });
  });
  api.get("/setup/status", async (_req, res) => {
    const users = await prisma.user.count();
    res.json({ needsSetup: users === 0, version: APP_VERSION });
  });
  api.post("/setup", async (req, res) => {
    if (await prisma.user.count()) throw forbidden("Setup is already complete.");
    const { companyName, username, name, password } = req.body ?? {};
    if (!companyName || !username || !name) throw badRequest("Company name, your name and username are required.");
    const p = passwordProblem(String(password ?? ""));
    if (p) throw badRequest(p);
    await prisma.$transaction(async (tx) => {
      if (!(await tx.company.findFirst())) await tx.company.create({ data: { name: String(companyName).slice(0, 150) } });
      await tx.user.create({ data: { username: String(username).trim().toLowerCase(), name: String(name).slice(0, 100), role: "SUPER_ADMIN", passwordHash: await hashPassword(password) } });
    });
    res.json({ ok: true });
  });
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts. Try again in 15 minutes." } });
  api.post("/auth/login", loginLimiter, async (req, res) => {
    const user = await login(String(req.body?.username ?? ""), String(req.body?.password ?? ""));
    setSessionCookie(res, await signSession(user));
    await audit(prisma, { user: { id: user.id, username: user.username, name: user.name, role: user.role }, permissions: new Set(), ip: req.ip, device: req.get("user-agent") }, "LOGIN", { type: "USER", id: user.id, code: user.username });
    res.json({ ok: true });
  });
  api.post("/auth/logout", async (req, res) => {
    const ctx = (req as any).ctx;
    if (ctx) await audit(prisma, ctx, "LOGOUT", { type: "USER", id: ctx.user.id, code: ctx.user.username });
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  // Google redirects the system browser here after sign-in. It may not carry the ERP session (the Windows app opens
  // Google in the normal browser), so it is authorised by the single-use random `state` created by a signed-in admin.
  api.get("/gdrive/callback", async (req, res) => {
    const page = (ok: boolean, text: string) => res.type("html").send(`<!doctype html><meta charset="utf-8"><title>GRL ERP - Google Drive</title><body style="font-family:Segoe UI,Arial;padding:40px;text-align:center"><h2 style="color:${ok ? "#1e8e4e" : "#c0392b"}">${ok ? "Google Drive connected" : "Google Drive not connected"}</h2><p>${text.replace(/[<>&]/g, "")}</p><p>You can close this tab and return to the ERP.</p></body>`);
    if (req.query.error) return page(false, `Google said: ${String(req.query.error)}`);
    try {
      const st = await gdrive.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
      await audit(prisma, null, "GOOGLE DRIVE CONNECT", { type: "BACKUP", code: st.email ?? "" });
      gsync.syncAll().catch(() => {});
      page(true, `Backups will be copied to ${st.email}'s Google Drive, folder "${gdrive.ROOT_FOLDER}".`);
    } catch (e) {
      page(false, (e as Error).message);
    }
  });

  // ------------------------------------------------ everything below needs a session
  api.use(requireAuth);

  // Licence gate: when expired the ERP is read-only, but backup, export, restore, licence and sign-out keep working.
  api.use(async (req, _res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return next();
    if (/^\/(auth|backup|restore|license|alerts|gdrive|data-export)/.test(req.path)) return next();
    const lic = await currentLicense();
    if (!lic.writable) return next(new AppError(402, `${lic.message}`));
    next();
  });

  api.get("/auth/me", async (req, res) => {
    const ctx = ctxOf(req);
    const [company, lic] = await Promise.all([admin.getCompany(), currentLicense()]);
    res.json({ user: ctx.user, permissions: [...ctx.permissions], company, license: lic, version: APP_VERSION, permissionLabels: PERMISSIONS });
  });
  api.post("/auth/password", async (req, res) => {
    const u = await admin.changeOwnPassword(ctxOf(req), req.body?.current, req.body?.next);
    setSessionCookie(res, await signSession(u));
    res.json({ ok: true });
  });

  api.get("/dashboard", async (req, res) => res.json(await analytics.dashboard(ctxOf(req))));
  api.get("/search", async (req, res) => res.json(await admin.search(ctxOf(req), String(req.query.q ?? ""))));

  // masters
  const kind = (req: Request) => {
    const k = String(req.params.kind);
    if (!masters.isMasterKind(k)) throw badRequest("Unknown master.");
    return k;
  };
  api.get("/freight-rate/find", async (req, res) => res.json(await masters.findRate(ctxOf(req), req.query as any)));
  api.get("/masters/:kind", async (req, res) => res.json(await masters.listMasters(ctxOf(req), kind(req), req.query)));
  api.get("/masters/:kind/options", async (req, res) => res.json(await masters.options(ctxOf(req), kind(req), String(req.query.q ?? ""))));
  api.get("/masters/:kind/:id", async (req, res) => res.json(await masters.getMaster(ctxOf(req), kind(req), req.params.id)));
  api.post("/masters/:kind", async (req, res) => res.json(await masters.saveMaster(ctxOf(req), kind(req), req.body)));
  api.put("/masters/:kind/:id", async (req, res) => res.json(await masters.saveMaster(ctxOf(req), kind(req), req.body, req.params.id)));

  // trips
  api.get("/trips", async (req, res) => res.json(await trips.listTrips(ctxOf(req), req.query)));
  api.get("/trips/:id", async (req, res) => res.json(await trips.getTrip(ctxOf(req), req.params.id)));
  api.post("/trips", async (req, res) => res.json(await trips.saveTrip(ctxOf(req), req.body)));
  api.put("/trips/:id", async (req, res) => res.json(await trips.saveTrip(ctxOf(req), req.body, req.params.id)));
  api.post("/trips/:id/status", async (req, res) => res.json(await trips.setTripStatus(ctxOf(req), req.params.id, req.body)));
  api.post("/trips/:id/cancel", async (req, res) => res.json(await trips.cancelTrip(ctxOf(req), req.params.id, String(req.body?.reason ?? ""))));

  // expenses
  api.get("/expenses", async (req, res) => res.json(await expenses.listExpenses(ctxOf(req), req.query)));
  api.get("/expenses/:id", async (req, res) => res.json(await expenses.getExpense(ctxOf(req), req.params.id)));
  api.post("/expenses", async (req, res) => res.json(await expenses.saveExpense(ctxOf(req), req.body)));
  api.put("/expenses/:id", async (req, res) => res.json(await expenses.saveExpense(ctxOf(req), req.body, req.params.id)));
  api.post("/expenses/:id/cancel", async (req, res) => res.json(await expenses.cancelExpense(ctxOf(req), req.params.id)));
  api.post("/expenses/:id/paid", async (req, res) => res.json(await expenses.markExpensePaid(ctxOf(req), req.params.id)));

  // billing
  api.get("/invoices", async (req, res) => res.json(await billing.listInvoices(ctxOf(req), req.query)));
  api.get("/invoices/billable/:customerId", async (req, res) => res.json(await billing.billableTrips(ctxOf(req), req.params.customerId)));
  api.get("/invoices/:id", async (req, res) => res.json(await billing.getInvoice(ctxOf(req), req.params.id)));
  api.get("/invoices/:id/pdf", async (req, res) => {
    const inv = await billing.getInvoice(ctxOf(req), req.params.id);
    const s = await settings.getSettings();
    const pdf = await invoicePdf(inv, s["invoice.terms"]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${inv.invoiceNumber.replace(/\//g, "-")}.pdf"`);
    res.send(pdf);
  });
  api.post("/invoices", async (req, res) => res.json(await billing.createInvoice(ctxOf(req), req.body)));
  api.post("/invoices/:id/cancel", async (req, res) => res.json(await billing.cancelInvoice(ctxOf(req), req.params.id, String(req.body?.reason ?? ""))));
  api.get("/receipts", async (req, res) => res.json(await billing.listReceipts(ctxOf(req), req.query)));
  api.post("/receipts", async (req, res) => res.json(await billing.createReceipt(ctxOf(req), req.body)));
  api.post("/receipts/:id/cancel", async (req, res) => res.json(await billing.cancelReceipt(ctxOf(req), req.params.id)));

  // settlements & transporter payments
  api.get("/settlements", async (req, res) => res.json(await settlements.listSettlements(ctxOf(req), req.query)));
  api.get("/settlements/:id", async (req, res) => res.json(await settlements.getSettlement(ctxOf(req), req.params.id)));
  api.put("/settlements/:id/deductions", async (req, res) => res.json(await settlements.updateDeductions(ctxOf(req), req.params.id, req.body)));
  api.get("/transporter-payments", async (req, res) => res.json(await settlements.listPayments(ctxOf(req), req.query)));
  api.post("/transporter-payments", async (req, res) => res.json(await settlements.createPayment(ctxOf(req), req.body)));
  api.post("/transporter-payments/:id/cancel", async (req, res) => res.json(await settlements.cancelPayment(ctxOf(req), req.params.id)));

  // profit, targets, receivables, payables
  api.get("/profit", requirePerm("profit.view"), async (req, res) => {
    const from = String(req.query.from ?? ""), to = String(req.query.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest("from and to dates are required.");
    res.json(await analytics.profitSummary(from, to));
  });
  api.get("/targets", async (req, res) => res.json(await analytics.allTargets(ctxOf(req))));
  api.post("/targets", async (req, res) => res.json(await analytics.saveTarget(ctxOf(req), req.body)));
  api.get("/receivables", async (req, res) => res.json(await analytics.receivables(ctxOf(req))));
  api.get("/payables", async (req, res) => res.json(await analytics.payables(ctxOf(req))));

  // reports
  api.get("/reports", async (req, res) => res.json(reports.reportList(ctxOf(req))));
  api.get("/reports/:key", async (req, res) => {
    const ctx = ctxOf(req);
    const r = await reports.runReport(ctx, req.params.key, req.query);
    const format = String(req.query.format ?? "json");
    const company = (await admin.getCompany())?.name ?? "G Road Lines";
    const base = `${r.title.replace(/[^\w]+/g, "_")}_${new Date().toISOString().slice(0, 10)}`;
    if (format === "json") return res.json(r);
    await audit(prisma, ctx, "EXPORT", { type: "REPORT", code: `${r.title} (${format})` });
    if (format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
      return res.send(await reportXlsx(r, company));
    }
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
      return res.send(reportCsv(r));
    }
    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
      return res.send(await reportPdf(r, company));
    }
    throw badRequest("Unknown format.");
  });

  // documents
  api.get("/documents", async (req, res) => res.json(await documents.listDocuments(ctxOf(req), req.query)));
  api.post("/documents", upload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest("Choose a file.");
    res.json(await documents.uploadDocument(ctxOf(req), req.file, req.body));
  });
  api.get("/documents/:id/file", async (req, res) => {
    const f = await documents.documentFile(ctxOf(req), req.params.id);
    res.setHeader("Content-Type", f.doc.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${f.doc.fileName.replace(/"/g, "")}"`);
    fs.createReadStream(f.path).pipe(res);
  });

  // alerts
  api.get("/alerts", async (req, res) => res.json(await alerts.listNotifications(ctxOf(req), req.query)));
  api.get("/alerts/expiry", async (req, res) => { ctxOf(req); res.json(await alerts.expiryList()); });
  api.post("/alerts/refresh", async (req, res) => { ctxOf(req); res.json({ created: await alerts.refreshNotifications() }); });
  api.post("/alerts/:id/read", async (req, res) => res.json(await alerts.markRead(ctxOf(req), req.params.id === "all" ? "all" : req.params.id)));

  // ------------------------------------------------ backup & restore
  api.get("/backup/health", requirePerm("backup.create"), async (_req, res) => res.json(await backup.backupHealth()));
  api.get("/backup/history", requirePerm("backup.create"), async (_req, res) => res.json(await prisma.backupRecord.findMany({ orderBy: { createdAt: "desc" }, take: 200 })));
  api.get("/backup/files", requirePerm("backup.create"), async (_req, res) => res.json(backup.listBackupFiles().map(({ path: _p, ...f }) => f)));
  api.post("/backup/now", requirePerm("backup.create"), async (req, res) => {
    const withDatabase = req.body?.withDatabase !== false;
    const r = await backup.createExcelBackup(req.body?.type === "PRE-UPDATE" ? "PRE-UPDATE" : "MANUAL", ctxOf(req).user.name, { withDatabase });
    res.json({ ...r, location: BACKUP_DIRS.excel });
  });
  api.post("/backup/emergency", requirePerm("backup.create"), async (req, res) => res.json(await backup.emergencyBackup(ctxOf(req).user.name)));
  api.post("/backup/export-all", requirePerm("backup.create"), async (req, res) => {
    const r = await backup.exportAll(ctxOf(req).user.name);
    await audit(prisma, ctxOf(req), "EXPORT", { type: "BACKUP", code: r.fileName });
    res.json({ fileName: r.fileName, location: BACKUP_DIRS.archive });
  });
  api.get("/backup/download/:name", requirePerm("backup.create"), async (req, res) => {
    const p = backup.resolveBackupFile(String(req.params.name));
    if (!p) throw new AppError(404, "File not found in the backup folders.");
    res.download(p);
  });
  api.get("/backup/import-template", requirePerm("backup.restore"), async (_req, res) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="GRL_ERP_IMPORT_TEMPLATE.xlsx"`);
    res.send(await writeImportTemplate());
  });
  api.post("/backup/verify", requirePerm("backup.create"), async (req, res) => {
    const p = req.body?.fileName ? backup.resolveBackupFile(String(req.body.fileName)) : req.body?.token ? restoreSvc.stagedPath(String(req.body.token))?.filePath : null;
    if (!p) throw badRequest("Choose a backup file.");
    const r = await backup.verifyBackupFile(p);
    await audit(prisma, ctxOf(req), "VERIFY BACKUP", { type: "BACKUP", code: path.basename(p) }, null, { ok: r.verification.checksumOk });
    res.json(r);
  });
  api.get("/backup/retention", requirePerm("backup.create"), async (_req, res) => res.json(await backup.retentionPlan()));
  api.post("/backup/retention/delete", requirePerm("backup.restore"), async (req, res) => {
    if (req.body?.confirm !== "DELETE") throw badRequest('Type DELETE to confirm.');
    res.json({ deleted: await backup.deleteBackupFiles(Array.isArray(req.body?.files) ? req.body.files : [], ctxOf(req).user.name) });
  });
  api.post("/backup/open-folder", requirePerm("backup.create"), async (req, res) => {
    const which = req.body?.which === "database" ? BACKUP_DIRS.database : req.body?.which === "excel" ? BACKUP_DIRS.excel : BACKUP_DIRS.root;
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
    if (local) {
      const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
      try { spawn(cmd, [which], { detached: true, stdio: "ignore" }).on("error", () => {}).unref(); } catch { /* no desktop */ }
    }
    res.json({ path: which, opened: local });
  });
  // ------------------------------------------------ Google Drive
  const redirectUri = () => `http://localhost:${config.port}/api/gdrive/callback`;
  api.get("/gdrive/status", requirePerm("backup.create"), async (_req, res) => {
    const pending = await prisma.backupRecord.count({ where: { driveStatus: { in: ["PENDING", "FAILED"] } } });
    const last = await prisma.backupRecord.findFirst({ where: { driveStatus: "UPLOADED" }, orderBy: { driveUploadedAt: "desc" } });
    const s = await settings.getSettings();
    res.json({ ...(await gdrive.driveStatus()), redirectUri: redirectUri(), autoUpload: s["gdrive.autoUpload"] !== "false", pending, lastUploadAt: last?.driveUploadedAt ?? null, lastUploadFile: last?.fileName ?? null });
  });
  api.post("/gdrive/client", requirePerm("backup.restore"), async (req, res) => {
    try { await gdrive.saveClient(String(req.body?.clientId ?? ""), String(req.body?.clientSecret ?? "")); } catch (e) { throw badRequest((e as Error).message); }
    await audit(prisma, ctxOf(req), "GOOGLE DRIVE SETUP", { type: "BACKUP" });
    res.json(await gdrive.driveStatus());
  });
  api.post("/gdrive/connect", requirePerm("backup.restore"), async (_req, res) => {
    try { res.json({ url: await gdrive.authUrl(redirectUri()) }); } catch (e) { throw badRequest((e as Error).message); }
  });
  api.post("/gdrive/disconnect", requirePerm("backup.restore"), async (req, res) => {
    await gdrive.disconnect();
    await audit(prisma, ctxOf(req), "GOOGLE DRIVE DISCONNECT", { type: "BACKUP" });
    res.json(await gdrive.driveStatus());
  });
  api.post("/gdrive/sync", requirePerm("backup.create"), async (_req, res) => {
    try { res.json(await gsync.syncAll()); } catch (e) { throw badRequest((e as Error).message); }
  });
  api.post("/gdrive/upload/:id", requirePerm("backup.create"), async (req, res) => {
    const r = await gsync.uploadBackup(String(req.params.id)).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (!r.ok) throw badRequest((r as any).error);
    res.json(r);
  });
  api.get("/gdrive/files", requirePerm("backup.create"), async (_req, res) => {
    try { res.json(await gsync.driveBackups()); } catch (e) { throw badRequest((e as Error).message); }
  });
  api.post("/gdrive/stage", requirePerm("backup.restore"), async (req, res) => {
    const fileId = String(req.body?.fileId ?? "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw badRequest("Choose a file.");
    let d;
    try { d = await gsync.downloadForRestore(fileId); } catch (e) { throw badRequest((e as Error).message); }
    res.json({ ...restoreSvc.stageUpload(d.tmpPath, d.fileName), documents: d.documents });
  });

  // ------------------------------------------------ import any client file
  api.get("/data-import/targets", requirePerm("backup.restore"), (_req, res) => res.json({ targets: IMPORT_TARGETS, extensions: IMPORT_EXTENSIONS }));
  api.post("/data-import/upload", requirePerm("backup.restore"), restoreUpload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest("Choose a file.");
    let tables;
    try { tables = await readAnyFile(req.file.path, req.file.originalname); } catch (e) { fs.rmSync(req.file.path, { force: true }); throw badRequest((e as Error).message); }
    const staged = restoreSvc.stageUpload(req.file.path, req.file.originalname);
    res.json({ ...staged, tables: tables.map((t, i) => ({ index: i, name: t.name, headerRow: t.headerRow, headers: t.headers, rowCount: t.rows.length, sample: t.rows.slice(0, 8).map((r) => r.values.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))) })) });
  });
  const stagedImport = (req: Request) => {
    const s = restoreSvc.stagedPath(String(req.body?.token ?? ""));
    if (!s) throw badRequest("Upload the file again.");
    const target = String(req.body?.target ?? "") as SheetKey;
    if (!IMPORT_TARGETS.some((t) => t.key === target)) throw badRequest("Choose what the file contains.");
    return { ...s, target, tableIndex: Number(req.body?.table ?? 0) };
  };
  api.post("/data-import/suggest", requirePerm("backup.restore"), async (req, res) => {
    const s = stagedImport(req);
    const tables = await readAnyFile(s.filePath, s.fileName);
    const t = tables[s.tableIndex];
    if (!t) throw badRequest("Sheet not found.");
    res.json({ fields: importFields(s.target), mapping: suggestMapping(s.target, t.headers) });
  });
  api.post("/data-import/prepare", requirePerm("backup.restore"), async (req, res) => {
    const s = stagedImport(req);
    try {
      res.json(await prepareImport({ ...s, mapping: req.body?.mapping ?? {}, createMissing: req.body?.createMissing !== false, existing: req.body?.existing === "skip" ? "skip" : "update", defaults: req.body?.defaults }));
    } catch (e) { throw badRequest((e as Error).message); }
  });

  // ------------------------------------------------ export in many formats
  api.get("/data-export/datasets", requirePerm("backup.create"), (_req, res) => res.json({ datasets: datasets(), formats: EXPORT_FORMATS }));
  const exportArgs = (req: Request) => {
    const key = String(req.params.key) as SheetKey | "all";
    if (key !== "all" && !SHEETS.some((s) => s.key === key)) throw badRequest("Unknown data set.");
    const d = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const src = { ...req.query, ...(req.body ?? {}) } as any;
    return { key, from: d(src.from), to: d(src.to) };
  };
  api.get("/data-export/:key", requirePerm("backup.create"), async (req, res) => {
    const a = exportArgs(req);
    const format = String(req.query.format ?? "xlsx") as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) throw badRequest("Unknown format.");
    let out;
    try { out = await exportData(a.key, format, { from: a.from, to: a.to, company: (await admin.getCompany())?.name }); } catch (e) { throw badRequest((e as Error).message); }
    await audit(prisma, ctxOf(req), "EXPORT", { type: "DATA", code: out.fileName });
    res.setHeader("Content-Type", out.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${out.fileName}"`);
    res.send(out.body);
  });
  api.post("/data-export/:key/drive", requirePerm("backup.create"), async (req, res) => {
    const a = exportArgs(req);
    const format = String(req.body?.format ?? "gsheet");
    const asSheet = format === "gsheet";
    const fmt = (asSheet ? "xlsx" : format) as ExportFormat;
    if (!EXPORT_FORMATS.includes(fmt)) throw badRequest("Unknown format.");
    const out = await exportData(a.key, fmt, { from: a.from, to: a.to, company: (await admin.getCompany())?.name });
    const tmp = path.join(os.tmpdir(), `grl-export-${Date.now()}-${out.fileName}`);
    fs.writeFileSync(tmp, out.body);
    try {
      const f = await gdrive.uploadFile(tmp, { folder: "Exports", name: asSheet ? out.fileName.replace(/\.xlsx$/, "") : out.fileName, convertTo: asSheet ? "application/vnd.google-apps.spreadsheet" : undefined, appProperties: { export: a.key } });
      await audit(prisma, ctxOf(req), "EXPORT", { type: "DATA", code: `${out.fileName} -> Google Drive` });
      res.json({ name: f.name, link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` });
    } catch (e) {
      throw badRequest((e as Error).message);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  api.get("/settings", requirePerm("settings.edit"), async (_req, res) => res.json(await settings.getSettings()));
  api.put("/settings", async (req, res) => res.json(await settings.updateSettings(ctxOf(req), req.body ?? {})));

  api.post("/restore/upload", requirePerm("backup.restore"), restoreUpload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest("Choose an Excel file.");
    const head = Buffer.alloc(4);
    const fd = fs.openSync(req.file.path, "r");
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (!req.file.originalname.toLowerCase().endsWith(".xlsx") || head.toString("latin1", 0, 2) !== "PK") {
      fs.rmSync(req.file.path, { force: true });
      throw badRequest("Choose an Excel .xlsx file.");
    }
    res.json(restoreSvc.stageUpload(req.file.path, req.file.originalname));
  });
  api.post("/restore/stage-existing", requirePerm("backup.restore"), async (req, res) => {
    const p = backup.resolveBackupFile(String(req.body?.fileName ?? ""));
    if (!p || !p.endsWith(".xlsx")) throw badRequest("Backup file not found.");
    const tmp = path.join(os.tmpdir(), `grl-${Date.now()}.xlsx`);
    fs.copyFileSync(p, tmp);
    res.json(restoreSvc.stageUpload(tmp, path.basename(p)));
  });
  const restoreInput = (req: Request) => {
    const staged = restoreSvc.stagedPath(String(req.body?.token ?? ""));
    if (!staged) throw badRequest("Upload the backup file again.");
    const mode = String(req.body?.mode ?? "FULL").toUpperCase();
    if (!["FULL", "MERGE", "IMPORT"].includes(mode)) throw badRequest("Unknown restore mode.");
    const valid = new Set(SHEETS.map((s) => s.key));
    const sheets = Array.isArray(req.body?.sheets) ? (req.body.sheets as string[]).filter((s) => valid.has(s as SheetKey)) as SheetKey[] : undefined;
    return { ...staged, mode: mode as "FULL" | "MERGE" | "IMPORT", sheets, skipInvalid: req.body?.skipInvalid === true };
  };
  api.post("/restore/preview", requirePerm("backup.restore"), async (req, res) => {
    const i = restoreInput(req);
    res.json({ fileName: i.fileName, plan: await restoreSvc.preview(i.filePath, i.mode, i.sheets, i.skipInvalid) });
  });
  api.post("/restore/run", requirePerm("backup.restore"), async (req, res) => {
    const i = restoreInput(req);
    if (i.mode === "FULL" && req.body?.confirm !== "REPLACE") throw badRequest("THIS WILL REPLACE CURRENT DATABASE DATA. Type REPLACE to confirm.");
    if (i.mode !== "FULL" && req.body?.confirm !== true) throw badRequest("Please confirm the import.");
    res.json(await restoreSvc.runRestore({ ...i, userName: ctxOf(req).user.name }));
  });
  api.post("/restore/test", requirePerm("backup.create"), async (req, res) => {
    let filePath: string | null = null, fileName = "";
    if (req.body?.fileName) { filePath = backup.resolveBackupFile(String(req.body.fileName)); fileName = path.basename(String(req.body.fileName)); }
    else if (req.body?.token) { const s = restoreSvc.stagedPath(String(req.body.token)); filePath = s?.filePath ?? null; fileName = s?.fileName ?? ""; }
    else {
      const last = await prisma.backupRecord.findFirst({ where: { status: "VERIFIED", fileName: { endsWith: ".xlsx" } }, orderBy: { createdAt: "desc" } });
      if (last && fs.existsSync(last.filePath)) { filePath = last.filePath; fileName = last.fileName; }
    }
    if (!filePath) throw badRequest("No backup file to test. Click BACKUP NOW first.");
    res.json(await restoreSvc.runRestore({ filePath, fileName, mode: "FULL", dryRun: true, userName: ctxOf(req).user.name }));
  });
  api.get("/restore/history", requirePerm("backup.restore"), async (_req, res) => res.json(await prisma.restoreRecord.findMany({ orderBy: { startedAt: "desc" }, take: 100 })));
  api.post("/restore/:id/rollback", requirePerm("backup.restore"), async (req, res) => {
    if (req.body?.confirm !== "ROLLBACK") throw badRequest("Type ROLLBACK to confirm.");
    res.json(await restoreSvc.rollback(String(req.params.id), ctxOf(req).user.name));
  });
  api.get("/restore/:id/errors", requirePerm("backup.restore"), async (req, res) => {
    const r = await prisma.restoreRecord.findUnique({ where: { id: String(req.params.id) } });
    const p = (r?.summary as any)?.errorReport;
    if (!p || !fs.existsSync(p) || !path.resolve(p).startsWith(path.resolve(BACKUP_DIRS.logs))) throw new AppError(404, "No error report for this restore.");
    res.download(p);
  });

  // ------------------------------------------------ admin
  api.get("/company", async (req, res) => { ctxOf(req); res.json(await admin.getCompany()); });
  api.put("/company", async (req, res) => res.json(await admin.saveCompany(ctxOf(req), req.body)));
  api.get("/users", async (req, res) => res.json(await admin.listUsers(ctxOf(req))));
  api.post("/users", async (req, res) => res.json(await admin.saveUser(ctxOf(req), req.body)));
  api.put("/users/:id", async (req, res) => res.json(await admin.saveUser(ctxOf(req), req.body, req.params.id)));
  api.get("/roles", async (req, res) => res.json(await admin.rolePermissions(ctxOf(req))));
  api.put("/roles", async (req, res) => res.json(await admin.saveRolePermissions(ctxOf(req), req.body)));
  api.get("/audit", async (req, res) => res.json(await admin.listAudit(ctxOf(req), req.query)));
  api.get("/license", async (req, res) => { ctxOf(req); res.json(await admin.licenseInfo()); });
  api.get("/server-info", async (req, res) => {
    ctxOf(req);
    const addresses = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i!.address}:${config.port}`);
    res.json({ addresses, port: config.port, backupRoot: BACKUP_DIRS.root });
  });
  api.post("/license", async (req, res) => res.json(await admin.installLicense(ctxOf(req), String(req.body?.key ?? ""))));

  api.use((_req, _res, next) => next(new AppError(404, "Not found.")));
  app.use("/api", api);

  // ------------------------------------------------ web app (built React files)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = [path.resolve(here, "../../web"), path.resolve(here, "../../dist/web"), path.resolve(process.cwd(), "dist/web")].find((d) => fs.existsSync(path.join(d, "index.html")));
  if (webDir) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large." : err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return res.status(409).json({ error: `A record with the same ${(err.meta?.target as string[] | undefined)?.join(", ") ?? "value"} already exists.` });
      if (err.code === "P2003") return res.status(400).json({ error: "A linked record does not exist." });
      if (err.code === "P2025") return res.status(404).json({ error: "Record not found." });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again; if it continues, contact your administrator." });
  });
  return app;
}
