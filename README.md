# GreenCycle Waste Management ERP

A complete ERP for a **non-hazardous waste management company**: customers and sites, contracts and versioned rates, pickups, collection scheduling, field collection (mobile), weighbridge, segregation/processing, inventory, recyclable sales, purchases, expenses, fleet, customer billing, receipts, outstanding & ageing, double-entry accounts, GST, 23 reports, dashboard, documents, notifications, users/roles and a full audit trail.

> Scope: general / municipal / industrial **non-hazardous** waste and recyclables only. There are no hazardous-waste or e-waste workflows.

```
CUSTOMER → SITE → CONTRACT/RATE → PICKUP → SCHEDULE → VEHICLE + DRIVER → COLLECTION → GATE IN (gross)
→ GATE OUT (tare) → NET WEIGHT → PROCESSING (output + rejected + loss) → RECOVERED STOCK → SALE / DISPOSAL
→ CUSTOMER INVOICE → RECEIPT → OUTSTANDING → ACCOUNTS → GST → REPORTS
```

## Stack
Next.js 15 (App Router, TypeScript, Server Actions) · Tailwind CSS 4 · Radix UI · PostgreSQL 16 · Prisma 6 · Zod · React Hook Form · Recharts · ExcelJS · PDFKit · jose (JWT sessions) + bcrypt · Vitest · Playwright.

## Easiest start on Windows
1. Install **Node.js LTS** (nodejs.org) and **PostgreSQL** (postgresql.org); in pgAdmin create a database named `waste_erp`.
2. On GitHub click **Code → Download ZIP**, then unzip it (right-click → Extract All).
3. In the unzipped folder double-click **SETUP-WINDOWS.bat** and type your PostgreSQL password when asked.
4. The app opens at http://localhost:3000 — sign in with `admin` / `Admin@123`. Next time double-click **START-WINDOWS.bat**.

## Quick start (local)
```bash
npm install
cp .env.example .env                 # set DATABASE_URL, AUTH_SECRET, SEED_ADMIN_PASSWORD
npx prisma migrate deploy            # create tables
npm run db:seed                      # base config + clearly-marked DEMO DATA
npm run dev                          # http://localhost:3000
```
Sign in as `admin` with the `SEED_ADMIN_PASSWORD` you set. Demo users (`mgmt`, `ops`, `weigh`, `process`, `sales`, `accounts`) use `SEED_DEMO_PASSWORD`. Skip demo data with `SEED_DEMO=false npm run db:seed`.

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / start |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Seed base configuration (+ demo data) |
| `npm test` | Unit + integration tests (uses `.env.test` database) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run backup` / `npm run restore -- <file>` | Database + uploads backup / restore |
| `npm run typecheck` / `npm run lint` | Static checks |

## Documentation
- [SETUP.md](SETUP.md) – local installation step by step
- [DATABASE.md](DATABASE.md) – schema, integrity rules, migrations, backup & restore
- [USER_GUIDE.md](USER_GUIDE.md) – how each module is used, by role
- [API_DOCUMENTATION.md](API_DOCUMENTATION.md) – HTTP routes and server actions
- [DEPLOYMENT.md](DEPLOYMENT.md) – production deployment (VM or Docker)
- [TESTING.md](TESTING.md) – test strategy and how to run tests
- [ARCHITECTURE.md](ARCHITECTURE.md) – design, security, decisions, **Future V2 improvements**

## Status
- 24 modules implemented; 23 reports with Excel / CSV / PDF / print.
- 49 unit + integration tests and 5 Playwright E2E tests (including the full 22-step business flow) pass.
- The Accounts module is operational bookkeeping (double-entry ledgers, trial balance, receivables/payables, GST registers). It is **not** a replacement for statutory accounting/filing software — have your accountant finalise statutory statements and returns.
