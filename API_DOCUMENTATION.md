# API Documentation

The UI talks to the server through **Next.js Server Actions** (typed RPC, protected by Next's same-origin check) and a small set of **HTTP route handlers** for files and health checks. All business rules live in the service layer (`src/server/services/*`) and every call checks permissions there.

## Authentication
- `POST /login` (server action `login`): verifies bcrypt hash, locks after 5 failures for 15 min, sets `erp_session` cookie (HS256 JWT signed with `AUTH_SECRET`; `httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`).
- Sessions are invalidated on password change/reset or when a user is disabled (`sessionVersion`).
- Unauthenticated requests: pages redirect to `/login`; `/api/*` returns `401 {"error":"Not signed in"}`.
- Missing permission: pages redirect to `/forbidden`; API returns `403`.
- State-changing `/api/*` requests must send an `Origin` header matching the host (CSRF protection).

## HTTP routes
| Method & path | Permission | Description |
|---|---|---|
| `GET /api/health` | public | `{"status":"ok","database":"ok"}` or 503 |
| `POST /api/documents` | `documents.manage` or the module's manage permission | multipart: `file`, `category`, `entityType?`, `entityId?`, `description?` → `{id, originalName}`. PDF/JPG/PNG/WEBP/XLSX/DOCX, magic-number checked, ≤ `MAX_UPLOAD_MB` |
| `GET /api/documents/:id` | `documents.view` or module view | Streams the file |
| `GET /api/invoices/:id/pdf[?download=1]` | `billing.view` | Customer tax invoice PDF |
| `GET /api/sales/:id/pdf[?download=1]` | `sales.view` | Recyclable sales invoice PDF |
| `GET /api/weighments/:id/slip` | `weighments.view` | Weighbridge slip PDF (A5) |
| `GET /api/statement?customerId&from&to&format=pdf\|xlsx` | `customers.view` | Customer statement of account |
| `GET /api/reports/:key/export?format=xlsx\|csv\|pdf&from&to&customerId&wasteTypeId&vehicleId&driverId&q` | `reports.view` + report's permission | Report export (audited) |

Report keys: `daily-collection, customer-collection, site-collection, vehicle-collection, driver-collection, waste-type, weighment, processing, recovery, inventory, recyclable-sales, customer-billing, customer-outstanding, ageing, purchase, expenses, fuel, vehicle-maintenance, revenue, profitability, gst, user-activity, audit-trail`.

Errors are JSON `{ "error": "<message a business user can understand>" }`. Stack traces are never returned.

## Server actions (`src/app/actions/*`)
Every action returns `{ ok: true, data } | { ok: false, error, fieldErrors? }` and validates input with the Zod schema in `src/lib/validation.ts`.

| File | Actions → service |
|---|---|
| `auth.ts` | `login`, `logout`, `changePasswordAction`, `markReadAction` |
| `masters.ts` | `saveEntityAction(entity, id\|null, values)`, `setActiveAction(entity, id, active)` for customer, customerContact, site, wasteCategory, wasteType, vehicle, driver, buyer, supplier, location, expenseCategory, gstRate, inventoryItem |
| `contracts.ts` | `saveContractAction`, `addRateAction`, `reviseRateAction`, `cancelRateAction` |
| `operations.ts` | `savePickupAction`, `cancelPickupAction`, `createScheduleAction`, `assignScheduleAction`, `rescheduleAction`, `startScheduleAction`, `cancelScheduleAction`, `generateSchedulesAction`, `createCollectionAction` |
| `weighments.ts` | `gateInAction`, `gateOutAction`, `overrideNetAction` (admin), `cancelWeighmentAction` |
| `stock.ts` | `processingAction`, `cancelProcessingAction`, `stockMovementAction` |
| `trade.ts` | `salesAction`, `cancelSalesAction`, `purchaseAction`, `cancelPurchaseAction`, `expenseAction`, `cancelExpenseAction` |
| `fleet.ts` | `fuelAction`, `maintenanceAction` |
| `billing.ts` | `previewBillingAction`, `createInvoiceAction`, `cancelInvoiceAction`, `emailInvoiceAction` |
| `receipts.ts` | `openDocsAction`, `receiptAction`, `allocateReceiptAction`, `cancelReceiptAction`, `paymentAction`, `cancelPaymentAction` |
| `accounts.ts` | `journalAction`, `ledgerAccountAction` |
| `settings.ts` | `companyAction`, `gstSettingsAction`, `sequenceAction`, `settingAction` |
| `admin.ts` | `createUserAction`, `updateUserAction`, `resetPasswordAction`, `rolePermissionsAction`, `archiveDocumentAction` |

### Example payloads
Gate in / gate out (net weight is never accepted from the client):
```json
{ "vehicleId": "…", "customerId": "…", "siteId": "…", "wasteTypeId": "…", "locationId": "…",
  "gateInAt": "2026-10-07T08:10", "grossWeight": 8540, "slipNumber": "WB-1001" }
{ "weighmentId": "…", "tareWeight": 5100, "gateOutAt": "2026-10-07T08:55" }   // → netWeight 3440
```
Processing (must balance):
```json
{ "batchNo": "B-1", "date": "2026-10-07", "locationId": "…",
  "inputs": [{ "itemId": "RAW-DRY id", "quantity": 1000 }],
  "outputs": [{ "itemId": "RCV-PLASTIC id", "quantity": 700 }], "rejectedQty": 200, "lossQty": 100 }
```
Customer invoice:
```json
{ "customerId": "…", "siteId": null, "date": "2026-10-01", "periodFrom": "2026-09-01", "periodTo": "2026-09-30",
  "includeAuto": true, "manualLines": [{ "description": "Bin supply", "quantity": 2, "unit": "NOS", "rate": 1500, "gstRate": 18 }] }
```
Receipt:
```json
{ "date": "2026-10-05", "partyType": "CUSTOMER", "customerId": "…", "amount": 10148, "mode": "BANK_TRANSFER",
  "accountId": "<1010 Bank>", "reference": "UTR123", "allocations": [{ "invoiceId": "…", "amount": 10148 }] }
```

## Permission codes
`<module>.<action>` where action is `view`, `manage`, plus `weighments.override`, `inventory.override`, `reports.financial`. Modules: dashboard, customers, contracts, pickups, collections, weighments, processing, inventory, sales, purchases, expenses, vehicles, drivers, billing, receipts, accounts, gst, reports, masters, documents, users, settings, audit. Defaults per role are in `src/lib/permissions.ts`.
