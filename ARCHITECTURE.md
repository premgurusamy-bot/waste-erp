# Architecture

## Overview
```
Browser ──► Next.js (App Router)
             ├─ Server Components (pages)  ─► read models via Prisma (paginated, filtered in SQL)
             ├─ Server Actions (src/app/actions) ─► act(): session → Ctx, error mapping, revalidation
             │                                        └─► Service layer (src/server/services) ── Prisma ── PostgreSQL
             ├─ Route handlers (src/app/api)  ─► PDFs, Excel/CSV, uploads, health
             └─ Middleware ─► JWT session check, API origin check
```
- **Service layer is the single source of business rules.** Every service function takes a `Ctx` (user, permissions, IP, user agent), checks permissions (`assertCan`), validates with Zod, and runs inside `prisma.$transaction`. UI, actions, routes, seed and tests all call the same services — the demo data is created through them, so stock, journals and audit are consistent.
- **Shared helpers inside the transaction**: `nextNumber` (document numbering), `postStock`/`reverseStock` (inventory with atomic balances), `postJournal`/`reverseJournal` (balanced double entry), `audit` (who/what/old/new/IP/device), `computeTax` (CGST/SGST vs IGST).
- **UI**: server-rendered tables with URL-driven filters and pagination (works without JavaScript, keeps only one page of rows in memory). Forms use React Hook Form + the same Zod schemas as the server (`EntityForm` for standard forms; dedicated forms for weighment, processing, trade, billing and receipts). Charts: Recharts. Components: Tailwind + Radix primitives (dialog, dropdown).

## Key decisions
| Decision | Reason |
|---|---|
| Custom JWT cookie sessions (jose + bcrypt) instead of an auth framework | Credentials-only, small surface, session revocation through `sessionVersion`, works in middleware |
| Server Actions instead of a REST API for the UI | Type-safe, built-in same-origin CSRF protection, less code; a few route handlers for files |
| Server-rendered tables instead of a client grid | Server-side pagination/filtering, fast first paint, accessible; TanStack Table not needed for this data volume |
| Inventory balances table + transaction ledger | O(1) stock checks with row-level atomic updates; full history for ledger reports |
| Rates versioned rows (`effectiveFrom/To`, `previousRateId`) | Price changes never alter billed history; billing picks the version valid on each transaction date |
| Cancel/reverse instead of delete | Auditability; stock and journals are reversed with mirror entries |
| Double-entry posting for every financial document | Trial balance, receivables, payables and GST registers come from one consistent ledger |
| PDFKit for PDFs, ExcelJS for spreadsheets | Server-side, no headless browser needed |

## Security
- Passwords: bcrypt (cost 12); never stored or logged in plain text (audit redacts password fields). Lockout after 5 failures.
- Sessions: signed JWT in an `httpOnly`, `SameSite=Lax` cookie (`Secure` with `COOKIE_SECURE`); invalidated on password change/reset or user disable.
- Authorization: checked in every service function (not only in the UI); menu and pages filtered by permission; reports require their module permission.
- CSRF: Server Actions are same-origin only (Next.js); mutating `/api/*` requests must carry a matching `Origin`.
- Input validation: Zod on client and server; SQL injection prevented by Prisma parameterisation (raw SQL uses tagged templates only).
- Uploads: type allow-list + magic-number check, size limit, random file names outside the web root, served only through an authorised route with `nosniff`.
- Errors: users see friendly messages; stack traces only in server logs. CSV exports neutralise spreadsheet formulas.
- Headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader` off.
- Secrets only via environment variables; `.env` is git-ignored.

## Source layout
```
prisma/            schema.prisma, migrations, seed.ts
src/app/(app)/     authenticated pages, one folder per module
src/app/api/       route handlers (documents, PDFs, exports, health)
src/app/actions/   server actions (thin wrappers)
src/components/    ui primitives, forms, charts, shared widgets
src/lib/           validation (Zod), permissions catalogue, field definitions, utils
src/server/        services, auth, audit, numbering, inventory, accounting, gst, reports, export, pdf, seed
tests/             unit, integration, e2e
scripts/           backup.sh, restore.sh
```

## Performance
Indexes on all foreign keys used for lookups and on date columns used by lists and reports (`weighments.gateInAt`, `collection_entries.collectionDate`, `inventory_transactions(itemId, locationId, date)`, `customer_invoices(customerId, date)`, `audit_logs(createdAt)` …). Lists paginate (25–50 rows), reports show 500 rows on screen (totals and exports use all rows), dashboard aggregates in SQL.

## FUTURE V2 IMPROVEMENTS
Not implemented in V1 by design (documented, not built):
1. E-invoicing (IRN/QR via GST portal) and e-way bills for recyclable sales.
2. GSTR-1 / GSTR-3B JSON export.
3. Weighbridge hardware integration (serial/TCP indicator reading) and camera snapshot on gate-in.
4. Offline-capable field app (PWA with sync queue) and driver login linked to driver records.
5. Route optimisation and map view of the day's schedule.
6. Recurring schedule generation for weekly / alternate-day frequencies (V1 auto-generates daily sites; others are scheduled from pickups).
7. Multi-branch data segregation (branch-scoped users and reports).
8. Bank statement import and reconciliation; TDS handling; fixed assets/depreciation; profit & loss and balance sheet statements.
9. Customer self-service portal (pickup requests, invoices, statements, online payment).
10. Inventory valuation (weighted average cost) and material grade/quality tracking.
11. Scheduled report emails and SMS/WhatsApp notifications.
12. Two-factor authentication and SSO.
13. Background job runner for notifications and backups (currently request-triggered / cron).
