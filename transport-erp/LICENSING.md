# Licensing (administrator / vendor guide)

| Plan | Meaning |
|---|---|
| TRIAL | Automatic on a new installation: 30 days, no key needed |
| MONTHLY / YEARLY | Key with an expiry date |
| PERPETUAL | Key without expiry |

A key contains: License ID, Company, Machine ID (optional – locks the key to one computer), Start Date, Expiry Date, Plan, Maximum Users, and is
**signed with an Ed25519 private key**. The ERP contains only the matching **public key** (`src/server/license.ts`), so it can check keys but
nobody can create or edit one. The private key is never in the app, the web pages or the repository (`*.pem` is git-ignored).

What the customer sees: warnings 30 and 15 days before expiry, **URGENT** in the last 7 days, and **LICENSE EXPIRED** afterwards.
An expired licence never deletes data: the ERP becomes read-only, while backup, export, restore, licence renewal and contacting the administrator still work.
A key for a different Machine ID also makes the ERP read-only (with the same exceptions).

## One-time: create your key pair
```bash
npm run license:keygen -- licence-private.pem
```
Paste the printed public key into `VENDOR_PUBLIC_KEY_PEM` in `src/server/license.ts` and build / release the app.
Keep `licence-private.pem` safe (your computer + one offline copy). Whoever has it can issue keys.

## Issue a key
Ask the customer for the **Machine ID** (Settings → Licence) if you want to lock the key to their computer.
```bash
npm run license:issue -- --company "G Road Lines" --plan YEARLY --start 2026-10-08 --expiry 2027-10-07 --users 5 --machine GRL-XXXX-XXXX-XXXX-XXXX --key licence-private.pem
npm run license:issue -- --company "G Road Lines" --plan PERPETUAL --key licence-private.pem
```
The key (`GRL1.…`) is printed and saved in `licences/`. The customer pastes it in **Settings → Licence → Install licence**.
Every licence change is recorded in the audit log.
