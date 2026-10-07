# Database

PostgreSQL 16, managed with Prisma migrations (`prisma/migrations`). Table names are snake_case; columns are camelCase. Money is `numeric(14,2)`, weights/quantities `numeric(14,3)` (KG), rates `numeric(12,4)`.

## Tables
| Area | Tables |
|---|---|
| Organisation | `companies`, `branches`, `locations` (yards, stores, processing areas) |
| Security | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions` |
| Customers | `customers`, `customer_contacts`, `customer_sites` |
| Waste master | `waste_categories`, `waste_types` |
| Commercial terms | `contracts`, `customer_rates` (versioned by effective date) |
| Fleet | `vehicles`, `vehicle_documents`, `drivers`, `driver_documents`, `vehicle_fuel`, `vehicle_maintenance` |
| Parties | `buyers`, `suppliers` |
| Operations | `pickup_requests`, `collection_schedules`, `collection_entries`, `weighments` |
| Processing | `processing_batches`, `processing_inputs`, `processing_outputs` |
| Inventory | `inventory_items`, `inventory_balances`, `inventory_transactions` |
| Sales / billing | `sales_invoices`, `sales_invoice_items`, `customer_invoices`, `customer_invoice_items` |
| Money | `receipts`, `receipt_allocations`, `payments`, `payment_allocations` |
| Purchases / expenses | `purchases`, `purchase_items`, `expenses`, `expense_categories` |
| Accounts | `ledger_accounts`, `journal_entries`, `journal_lines` |
| GST | `gst_rates`, `gst_settings` |
| Platform | `documents`, `audit_logs`, `notifications`, `notification_reads`, `settings`, `number_sequences` |

Open `npx prisma studio` to browse, or read `prisma/schema.prisma` (commented).

## Traceability chain
`pickup_requests` → `collection_schedules.pickupRequestId` → `collection_entries.scheduleId` → `weighments.collectionEntryId` → stock receipt in `inventory_transactions (refType='WEIGHMENT', refId)` → `processing_*` (refType='PROCESSING') → `sales_invoices` (refType='SALES_INVOICE') ; billed weighments/trips point to `customer_invoice_items` (`weighments.customerInvoiceItemId`, `collection_entries.customerInvoiceItemId`) ; invoices → `receipt_allocations` → `receipts` ; every financial document has `journal_entries (sourceType, sourceId)`.

## Integrity rules
Enforced by the application **and** by the database (migration `integrity_checks`):
- Foreign keys on every relation; unique document numbers and master codes.
- Weighments: gross > 0; 0 ≤ tare < gross; net ≥ 0; **one open (GATE_IN) weighment per vehicle** (partial unique index); weighbridge slip numbers unique among non-cancelled weighments.
- Processing batches: `inputQty = outputQty + rejectedQty + lossQty` (CHECK constraint), all quantities non-negative.
- Line quantities > 0, rates ≥ 0; invoice `amountReceived` between 0 and total; receipt allocated ≤ amount; allocation targets exactly one document.
- Journal lines are one-sided (debit xor credit); every journal is balanced (checked in code before insert).
- Contract and rate date ranges valid; GST rate 0–100.
- Stock cannot go negative unless the item allows it or an administrator explicitly overrides (audited). Balances are updated with an atomic `UPDATE … RETURNING` inside the same transaction as the movement.

Financial and inventory operations run in a single database transaction: e.g. a recyclable sale writes the invoice, the stock reduction and the journal together, or nothing at all.

**No hard deletes** for business records: records are cancelled (`status = CANCELLED` with reason), voided by reversal entries (stock and journals), or deactivated (`INACTIVE`). Documents are archived (`deletedAt`), the file stays on disk.

## Numbering
`number_sequences` holds prefix, padding and whether the year is included (`INV-2026-00001`). Year-based sequences keep a counter per year (`CUSTOMER_INVOICE@2026`). Numbers are reserved with a row-locking `UPDATE … RETURNING`, so concurrent users never get duplicates. Prefixes are editable in **Settings → Document Numbering**.

## Migrations
```bash
npx prisma migrate dev --name <change>   # development: create a new migration
npx prisma migrate deploy                # production / CI: apply pending migrations
npx prisma migrate status                # check
```

## Backup
`scripts/backup.sh` (`npm run backup`) writes:
- `backups/waste_erp_<timestamp>.dump` — `pg_dump --format=custom` (verified with `pg_restore --list`)
- `backups/uploads_<timestamp>.tar.gz` — the `UPLOAD_DIR` folder

and deletes backups older than `KEEP_DAYS` (default 30). Options: `BACKUP_DIR=/mnt/backups KEEP_DAYS=60 npm run backup`.

Manual equivalent:
```bash
pg_dump --format=custom --no-owner --file waste_erp.dump "postgresql://erp:PASSWORD@localhost:5432/waste_erp"
tar -czf uploads.tar.gz -C storage uploads
```

Schedule daily (crontab of the app user):
```cron
30 1 * * * cd /opt/waste-erp && BACKUP_DIR=/var/backups/waste-erp npm run backup >> /var/log/waste-erp-backup.log 2>&1
```
Copy the backup folder off the server (object storage, another machine). Test a restore regularly.

## Restore
Stop the application, then:
```bash
npm run restore -- backups/waste_erp_20261007_192002.dump backups/uploads_20261007_192002.tar.gz
npx prisma migrate deploy        # if the dump came from an older version
```
The script asks you to type `RESTORE`; it runs `pg_restore --clean --if-exists --single-transaction`.

To check a backup without touching live data, restore into a scratch database:
```bash
createdb -O erp waste_erp_restore_check
pg_restore --no-owner --dbname postgresql://erp:PASSWORD@localhost/waste_erp_restore_check backups/<file>.dump
psql postgresql://erp:PASSWORD@localhost/waste_erp_restore_check -c "select count(*) from weighments"
dropdb waste_erp_restore_check
```
