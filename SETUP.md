# Setup (local development)

## Prerequisites
- Node.js 20+ (tested on 22) and npm 10+
- PostgreSQL 14+ (tested on 16), with `psql`, `pg_dump`, `pg_restore` on PATH for backups

## 1. Create the databases
```bash
sudo -u postgres psql <<'SQL'
CREATE USER erp WITH PASSWORD 'choose-a-password' CREATEDB;
CREATE DATABASE waste_erp OWNER erp;
CREATE DATABASE waste_erp_test OWNER erp;   -- only needed to run the test suite
SQL
```

## 2. Install and configure
```bash
npm install
cp .env.example .env
```
Edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://erp:<password>@localhost:5432/waste_erp?schema=public` |
| `AUTH_SECRET` | yes | ≥32 random characters: `openssl rand -base64 48` |
| `SESSION_HOURS` | no | Session lifetime (default 12) |
| `COOKIE_SECURE` | no | `true` when served over HTTPS |
| `UPLOAD_DIR` | no | Where documents/photos are stored (default `./storage/uploads`) |
| `MAX_UPLOAD_MB` | no | Max upload size (default 10) |
| `APP_TIMEZONE` | no | Business timezone (default `Asia/Kolkata`) |
| `SEED_ADMIN_PASSWORD` | seed only | Password for the initial `admin` user |
| `SEED_DEMO_PASSWORD` | seed only | Password for the demo users |
| `SEED_DEMO` | seed only | `false` to skip demo data |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Enables "Email invoice" |

For tests create `.env.test` (same keys) pointing at `waste_erp_test` — the test runner refuses any database whose name does not contain `test`.

## 3. Database
```bash
npx prisma migrate deploy     # creates all tables, constraints and indexes
npm run db:seed               # roles, permissions, GST rates, chart of accounts, masters (+ demo data)
```
The seed is idempotent for base configuration; demo data is only created once.

## 4. Run
```bash
npm run dev                   # http://localhost:3000
```
Sign in as `admin`. You will find demo customers (ABC Industries, City Mall, Hotel Grand, XYZ Textiles, City Corporation), vehicles TN 37 AB 1234 / 5678 / 9012, buyers, 45 days of collections and weighments, processing, sales, invoices, payments and expenses. The specification's sample weighment (TN 37 AB 1234, ABC Industries, Dry Waste, gross 8,540 – tare 5,100 = **net 3,440 KG**) is recorded for today.

All demo records carry the remark `DEMO DATA` (customers are flagged "Demo data").

## 5. Verify
```bash
npm run typecheck && npm run lint
npm test
npm run build && npm run test:e2e
```
