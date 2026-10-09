# Disaster recovery – G Road Lines ERP

**Goal: you can recover all business data even if the old computer and its database are gone.**
All you need is one backup file, for example `GRL_ERP_BACKUP_2026-10-08_13-30-00.xlsx`.

## Keep a copy away from the computer
The ERP writes backups to `Documents\G Road Lines ERP\Backup` every day. A dead hard disk takes that folder with it, so:
- **Connect Google Drive** (Backup & Restore → Google Drive). Every backup and all document photos are then copied to your Gmail account's Drive automatically.
- Copy the latest file from `Backup\Excel` (or the whole `Backup` folder) to a **USB drive / Google Drive / e-mail** at least once a week.
- Once a month click **EXPORT ALL DATA** and keep the ZIP somewhere safe (it also contains the database dump and all document files).
- Once a month click **RESTORE TEST**: it restores the latest backup in a test transaction and undoes it, proving the backup works.

## Old computer is dead – recover on a new computer
1. **Install the ERP** (GRL ERP Setup .exe, or Node.js + SETUP-WINDOWS.bat).
2. **Install the database**: PostgreSQL 16 from postgresql.org. Remember the password.
3. Start the ERP, enter the PostgreSQL password; create the administrator and **log in as admin**.
4. Open **Backup & Restore** → **RESTORE FROM EXCEL**.
5. **Select the latest Excel backup** (from the USB drive / download folder) – or connect Google Drive first and use **Backups in Google Drive → Restore** (document photos come back automatically).
6. **Verify backup** – the ERP checks the checksum of every sheet automatically. If you see *“Backup verification failed. The file may be damaged or modified.”*, use an older backup file.
7. **Preview records** – backup date and counts of customers, transporters, vehicles, drivers, trips, expenses, invoices, payments; errors (if any) with row numbers and suggested fixes.
8. **Confirm** – choose FULL RESTORE and type `REPLACE`.
9. **Import** – the ERP first makes a PRE-RESTORE backup of the (empty) new database, then restores everything in one transaction.
10. **Verify record counts** – the result screen lists expected vs restored count for every sheet and compares total revenue, expenses, profit, receivable, payable, trips, invoice value and payments with the backup. If anything does not match, the restore is undone automatically.
11. **Rebuild indexes** – done automatically after the restore (REINDEX + ANALYZE).
12. **Finish** – *RESTORE SUCCESSFUL*. Copy your old `Backup\Documents` folder (from the USB / export ZIP) into `Documents\G Road Lines ERP\Backup\Documents` before restoring, or afterwards, to bring back LR / POD / receipt photos; the ERP copies them into place automatically on the next restore.

Then: install the licence key for the new computer (**Settings → Licence**, send the new Machine ID to your administrator), re-create staff user logins (users are not stored in the business backup), and run **BACKUP NOW**.

## Restoring from the database backup instead (technical)
- `Backup\Database\GRL_DB_<time>.dump` – native PostgreSQL dump:
  `pg_restore --clean --if-exists --no-owner -d "postgresql://postgres:PASSWORD@localhost:5432/grl_erp" GRL_DB_<time>.dump`
- `Backup\Database\GRL_DB_SNAPSHOT_<time>.json.gz` – snapshot of every table (including users):
  `npx tsx scripts/restore-snapshot.ts <file> --yes` from the `transport-erp` folder (replaces every table).

## Something went wrong after a restore
**Backup & Restore → Restore history → Rollback** puts the data back exactly as it was before that restore (from its automatic PRE-RESTORE backup).
