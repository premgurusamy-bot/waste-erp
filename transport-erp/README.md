# G ROAD LINES – Transport Agent ERP (V1.0.0)

A complete ERP for a transport agent: customers, transporters, vehicles, drivers, trips, freight, hire, trip expenses,
LR / e-way bill / POD, customer billing with configurable GST, receipts, transporter settlements and payments,
receivables and payables ageing, profit / loss with the full calculation shown, target meter, 16 reports
(Excel / PDF / CSV), expiry alerts, documents with phone-camera upload, users and configurable role permissions,
audit log, licence keys, and **three levels of backup with verified Excel backup and restore**.

```
BOOKED → ALLOCATED → LOADED → IN TRANSIT → DELIVERED → POD RECEIVED → BILLED → SETTLED → CLOSED   (or CANCELLED)
Trip → Transporter settlement (hire − advance − deductions − payments) · Trip → Customer invoice → Receipts
```

| Part | Technology |
|---|---|
| Web app (desktop + phone layout) | React 18 + TypeScript (Vite) |
| Server | Node.js 22 + TypeScript (Express 5) |
| Database | PostgreSQL 16 via Prisma 6 |
| Windows app | Electron (`desktop/`) – or run the server with the `.bat` files |
| Android app | Capacitor 7 (`mobile/`) |
| Excel | ExcelJS (`.xlsx`) |

**The ERP database is the operational database. Excel is the backup / export / emergency-recovery format.**
Nothing in normal operation depends on Excel.

---

## 1. Most important: your data is safe

| Level | What | When |
|---|---|---|
| 1 | **Excel backup** `GRL_ERP_BACKUP_YYYY-MM-DD_HH-MM-SS.xlsx` – one workbook, `00_BackupInfo` + 23 sheets, SHA-256 checksum | Automatically once a day when the ERP is opened; **BACKUP NOW** any time |
| 2 | **Database backup** – `pg_dump` file (when PostgreSQL tools are installed) **and** a JSON snapshot of every table | With every manual / emergency backup, the daily automatic backup, before every restore, and automatically before a new version upgrades the database |
| 3 | **Manual full backup** – **EMERGENCY BACKUP** (Excel + database + document manifest + settings + verification) and **EXPORT ALL DATA** (`GRL_ERP_FULL_EXPORT_….zip` with `/Excel /Database /Documents /Manifest /Logs`) | Before reinstalling, updating, changing the database, restoring, moving to another computer |

Backups are written **outside the program folder**, so they survive updates and uninstall:

```
Documents/G Road Lines ERP/Backup/Excel/       daily + manual Excel backups, PRE_RESTORE_BACKUP_… files
Documents/G Road Lines ERP/Backup/Database/    pg_dump (.dump) and JSON snapshots (.json.gz)
Documents/G Road Lines ERP/Backup/Documents/   copies of uploaded files + DOCUMENT_MANIFEST_….json
Documents/G Road Lines ERP/Backup/Logs/        backup.log, RESTORE_ERRORS_….xlsx, SETTINGS_….json
Documents/G Road Lines ERP/Backup/Archive/     monthly copies (GRL_ERP_MONTHLY_YYYY-MM.xlsx) and full exports (.zip)
Documents/G Road Lines ERP/Files/              uploaded documents (LR, POD, receipts…)
```

| 4 | **Google Drive copy** – every verified backup (Excel + database file), every full export and all document photos are uploaded to *My Drive › G Road Lines ERP Backup* in your own Gmail / Google account | Automatically after every backup (retried hourly when offline); **Upload now** any time |

Every backup is a **new file** (never overwritten), is **read back and verified** immediately after writing,
and is listed in **Backup History** (AUTOMATIC / MANUAL / PRE-RESTORE / PRE-UPDATE / EMERGENCY, status SUCCESS / FAILED / VERIFIED / CORRUPTED).
Old backups are **never deleted automatically**: the Retention tab proposes files beyond “keep last 30 daily / 12 monthly”
and deletes only what you select and confirm by typing `DELETE`.

Reminders: no backup for 24 h → warning, 48 h → urgent, 7 days → critical (banner on every page + Alerts).

### Restore

**Backup & Restore → RESTORE FROM EXCEL** (or **IMPORT DATA**):

1. Read workbook → 2. check `00_BackupInfo` → 3. **verify checksum** (any changed cell fails: *“Backup verification failed. The file may be damaged or modified.”* – nothing is restored)
→ 4. check app / schema version → 5–10. validate every sheet, column, required field, value, date, amount, **duplicate IDs** and **every relationship**
(e.g. *“Trip TRP-000123 references missing Vehicle ID …”*) → 11. **preview** (backup date, record counts; NEW / UPDATED / DUPLICATE / INVALID per sheet, and what a full restore would remove)
→ 12. confirmation (full restore: type `REPLACE`) → 13. **automatic PRE-RESTORE backup** (Excel + database) → 14. restore in **one database transaction**
→ 15. **verify record counts and financial totals** (revenue, expenses, profit, receivable, payable, trips, invoice value, payments – must match the backup exactly, otherwise everything is rolled back)
→ 16. restore report (+ `RESTORE_ERRORS.xlsx` with Sheet / Row / Record ID / Field / Error / Suggested Fix).

| Mode | What it does |
|---|---|
| **FULL RESTORE** | Replaces the business data with the backup (users and licence are kept) |
| **MERGE** | Adds missing records, updates existing ones (matched by permanent UUID). **Never deletes.** |
| **IMPORT ONLY** | Only the sheets you tick (e.g. only Customers). Also accepts a filled-in **import template** (IDs and codes are created automatically) |

Invalid records are never imported silently: the import fails with exact errors, unless you explicitly tick
“Skip the N invalid record(s)” (MERGE / IMPORT only). After any restore, **ROLLBACK** puts the data back exactly as
it was, from the PRE-RESTORE backup. **RESTORE TEST** performs a complete restore of the latest backup inside a
transaction and then undoes it – proof that the backup really works, without changing anything.

### Google Drive (your Gmail account)
One-time setup on **Backup & Restore → Google Drive** (about 5 minutes, steps shown on screen): create a free Google Cloud project with your
Gmail account, enable the Google Drive API, set up the OAuth consent screen (and **publish** it, otherwise Google disconnects after 7 days),
create an OAuth client of type *Web application* with redirect URI `http://localhost:4000/api/gdrive/callback`, paste the Client ID and
secret, click **Connect Google Drive** and sign in. Do this on the office computer itself.
- The ERP asks only for the `drive.file` permission: it can see and change **only the files it created**, never your other Drive files or e-mail.
- The Client secret and the sign-in token are stored **encrypted** on the computer and are never written into Excel backups.
- Folders: `G Road Lines ERP Backup/Excel`, `/Database`, `/Documents` (LR / POD / receipt photos), `/Exports`.
- **Restore from Google Drive**: *Backups in Google Drive → Restore* downloads the file (and missing document photos) and opens the normal
  restore wizard (checksum verification, preview, pre-restore backup, rollback). On a new computer: install, connect Google Drive, restore.

See **[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)** for the step-by-step recovery on a new computer.

### Excel workbook layout
`00_BackupInfo` (Backup ID, Application Version, Company Name, Company GSTIN, Backup Date / Time, Database Version,
Schema Version, record counts, Total Records, Checksum, Created By, per-sheet SHA-256, financial totals) and
`01_Company 02_Customers 03_Transporters 04_Vehicles 05_Drivers 06_LoadingPoints 07_DeliveryPoints 08_Trips 09_TripItems 10_Freight
11_Expenses 12_CustomerInvoices 13_InvoiceItems 14_CustomerReceipts 15_TransporterSettlements 16_TransporterPayments 17_Documents
18_VehicleDocuments 19_DriverDocuments 20_Targets 21_Notifications 22_AuditLogs 23_Settings`.
Human readable: real dates and amounts, header row, filters, frozen panes, totals rows, names next to IDs.
Grey columns (names, profit, balances) are calculated for reading and ignored on restore. No Excel formulas are used.
Every record has a permanent UUID (plus a readable code such as `TRP-000123`); row numbers are never identifiers.

---

## 1a. Import any client data / export in any format
**Import & Export → Import client data** takes the client's own file – Excel (.xlsx/.xlsm), CSV, TSV, TXT (any delimiter) or JSON,
exported from Tally, Busy, another ERP or their own register:
1. Choose the file (title rows above the header are skipped automatically).
2. Say what the rows are: customers, transporters, vehicles, drivers, loading / delivery points, freight rates, trips, expenses, customer receipts or transporter payments.
3. **Columns are matched automatically** from the words transporters use (“Party Name”, “Lorry No”, “GC No”, “Lorry Hire”, “Hamali”, “From / To”, “Wt (MT)”…) – change any match.
4. **Check data**: names are matched to existing records (customer “abc manufacturing” → ABC Manufacturing; “TN 37 AB 1234” → TN37AB1234);
   missing customers / vehicles / drivers / places / transporters can be created; rows that match an existing record update it **without
   blanking fields the file does not have**; amounts like “Rs. 1,25,000/-” and dates like 08-Oct-2026, 08/10/26 are cleaned.
5. Errors are listed with the **row numbers of the client's file**. Import runs through the same safe engine as restore: safety backup first,
   one transaction, verification, rollback. Trips get their transporter settlements automatically.

Old .xls / .ods: “Save As .xlsx” first. PDFs and photos cannot be read as data.

**Import & Export → Export data**: any table (or ALL DATA) as **Excel, CSV, TSV, JSON, XML, PDF or HTML**, with a date range for trips,
expenses, invoices and payments; with Google Drive connected also **Open in Google Sheets** and **Save to Google Drive**.

---

## 2. Install on Windows

### Option A – Windows desktop app (recommended)
1. Install **PostgreSQL 16** from postgresql.org (remember the password you choose).
2. Install **GRL ERP Setup 1.0.0.exe** (built by GitHub Actions – see §6 – or `cd desktop && npm install && npm run dist:win`).
3. Open **GRL ERP**. First time: type the PostgreSQL password → **Save and start**. The database `grl_erp` is created automatically.
4. Create the administrator. If you are moving from another computer, go straight to **Backup & Restore → RESTORE FROM EXCEL**.

The window title shows **GRL ERP 1.0.0**; **Help → About** shows the version and licence status.
**Help → Database settings** reconnects to a different database (data is not deleted).

### Option B – server mode with batch files
1. Install **Node.js 22 LTS** and **PostgreSQL 16**.
2. Double-click **SETUP-WINDOWS.bat** (asks the PostgreSQL password, installs, builds, creates the tables, asks for sample data and the admin password).
3. Every day: double-click **START-WINDOWS.bat** and open http://localhost:4000.

### Updating to a new version
Click **BACKUP BEFORE UPDATE** (Backup & Restore), install the new version, start it. On first start of a new version the ERP
automatically takes a **PRE-UPDATE database backup** and then upgrades the database tables.

---

## 3. Android phones
Phones use the same central database through the ERP running on the office computer.
1. On the office computer run **ALLOW-PHONES.bat** once. **Settings → Mobile app** shows the address (e.g. `http://192.168.1.20:4000`).
2. Install the APK (`GRL-ERP.apk`, built by GitHub Actions – §6 – or `cd mobile && npm install && npm run apk` with Android Studio / SDK installed).
3. Open **GRL ERP**, type the address, **Connect**, sign in.

Phone layout: Dashboard / Trips / More, quick buttons **NEW TRIP · EXPENSE · POD · PAYMENT · CUSTOMER**, today's trips,
pending loads, in transit, delivered, pending POD, today's profit and the monthly target. **📷 Take photo** on a trip,
expense or vehicle uploads POD / LR / receipt photos straight from the camera (uploading a POD marks the trip POD RECEIVED).
Without the APK, open the address in Chrome → **Add to Home screen**.

---

## 4. Daily use (short)
- **Trips**: New Trip → customer, route, vehicle, driver, LR, e-way bill, freight, hire, loading, unloading, diesel, toll, RTO, driver bata, other, advance.
  Freight / hire are filled from the **freight rate card** when one matches. Profit, profit %, revenue / cost / profit per KM update live.
- **Billing**: New Invoice → pick customer → tick unbilled trips → choose GST (none / CGST+SGST / IGST / reverse charge; rate 0/5/12/18 %) → PDF.
  Record payments (with TDS) against invoices or on account. Invoice numbers `GRL/2026-27/0001` restart every financial year.
- **Payments → Transporter settlements**: deductions (shortage, damage…), pay the balance; trip becomes SETTLED.
- **Receivables** 0–30 / 31–60 / 61–90 / 90+, **Payables** transporter / driver / other.
- **Profitability** and **Targets** (daily, weekly Mon–Sun, monthly, financial year): ON TRACK / AT RISK / BEHIND TARGET / TARGET ACHIEVED with every formula shown.
- **Alerts**: RC, insurance, FC, permit, pollution, road tax, driver licence – expired / 7 / 15 / 30 / 60 days.
- **Search** (top bar): trip, LR, e-way bill, invoice, vehicle, customer, transporter, driver, mobile.

### Profit formula
`NET PROFIT = Revenue − (Hire + Loading + Unloading + Diesel + Toll + RTO + Driver Bata + Other + expense entries linked to the trip)`;
for a period, other expenses (office, salary, repair…) are subtracted as well. Profit % = Profit / Revenue × 100.

### Target formula
Remaining = Target − Achieved · Achievement % = Achieved / Target × 100 · Required daily = Remaining / days remaining ·
Current daily average = Achieved / days elapsed · Projected = average × days in period ·
ACHIEVED if achieved ≥ target, ON TRACK if projected ≥ target, AT RISK if projected ≥ 85 %, else BEHIND TARGET.

---

## 5. Users, security, licence
Roles: SUPER ADMIN, ADMIN, TRANSPORT MANAGER, OPERATIONS, ACCOUNTS, VIEWER – permissions editable in **Settings → Role permissions**
(SUPER ADMIN can never lose users / backup / restore / settings / licence). Security: bcrypt password hashing, signed httpOnly session
cookie, account lock after 5 wrong passwords, login rate limiting, permission checks in every server function, Zod input validation,
Prisma parameterised SQL, React output escaping + Content-Security-Policy (XSS), CSRF protection (custom header + same origin),
upload type check by file content, `nosniff`, security headers, HTTPS-ready (`COOKIE_SECURE=true` behind a TLS reverse proxy).
Audit log: login, logout, create, edit, status, cancel, payment, invoice, settlement, backup, verify, restore, import, export, licence and
password changes, Google Drive connect / disconnect – user, date / time, action, record ID / code, old and new values.

Licence (TRIAL 30 days / MONTHLY / YEARLY / PERPETUAL) – Ed25519-signed keys, see **[LICENSING.md](LICENSING.md)**.
Warnings at 30, 15 and 7 days. **Expired: no data is deleted**; the ERP is read-only while backup, export, restore, licence renewal and
sign-out keep working.

---

## 6. Developers

```bash
cp .env.example .env               # set DATABASE_URL and AUTH_SECRET
npm install
npx prisma migrate deploy          # (the server also applies migrations on start)
npm run db:seed                    # admin + SAMPLE DATA (SEED_DEMO=false for none; SEED_ADMIN_PASSWORD=…)
npm run dev                        # API :4000 + web :5173   |   npm run build && npm start  → http://localhost:4000
npm test                           # needs a PostgreSQL database named grl_erp_test (TEST_DATABASE_URL)
npm run typecheck
```

Sample data: 20 customers, 10 transporters, 20 vehicles, 30 drivers, 6 loading / 8 delivery points, 3 rate cards, 100 trips
(first trip: ABC Manufacturing, Coimbatore → Tiruppur, freight ₹30,000, hire ₹22,000, expenses ₹3,000, profit ₹5,000),
200 expenses, 50 invoices with receipts, transporter settlements and payments, targets.

**Tests (63)** – including the mandatory one: *create data → export Excel → drop the whole database → recreate it → restore from Excel →
compare record counts, every ID, every stored value and all financial totals* (`tests/backup-restore.test.ts`). Also: checksum tampering,
missing relationships, duplicate IDs, merge never deletes, import-only with a hand-made file, invalid rows, restore test (dry run),
pre-restore backup + rollback, emergency backup, export ZIP, retention, the registry covers every database column, profit, target meter,
GST, financial year, licence expiry and signatures, permissions, CSRF, uploads, account lock, expired-licence read-only mode, migrations.
Scale check: 10,000 trips + 60,000 expenses + 40,000 audit rows (111,605 records) – backup 33 s, restore test 42 s.

GitHub Actions (`.github/workflows/transport-erp.yml`) runs the tests and builds the **Android APK** and the **Windows installer**;
download them from the workflow run's *Artifacts*.

```
prisma/                 schema + migrations
src/shared/             calculations shared by server and web (profit, target, GST, FY, ageing) + permissions
src/server/             Express app, auth, licence, audit, services/, backup/ (sheets registry, export, read, restore, service)
src/web/                React app (pages/, components/)
desktop/                Electron Windows app      mobile/   Capacitor Android app
tests/                  Vitest (unit + integration against PostgreSQL)
scripts/                licence key tools, Windows setup
```

Not included in V1 (by design): e-invoicing / IRN and e-way bill portal APIs, GSTR returns, double-entry accounting ledgers,
offline mode on phones, iOS app, code-signing of the Windows installer.
