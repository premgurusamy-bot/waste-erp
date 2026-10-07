# Testing

| Layer | Tool | Location | What it covers |
|---|---|---|---|
| Unit | Vitest | `tests/unit` | Net-weight calculation, processing balance, billing arithmetic, rate selection, GST split/round-off, ageing, expiry states, validation, amount in words |
| Integration | Vitest + PostgreSQL | `tests/integration` | Service layer against a real database: customers, pickups → collection, weighment, processing, inventory, sales rollback, billing, payments, permissions, audit, accounting balance |
| End-to-end | Playwright (Chromium) | `tests/e2e` | Full 22-step business flow through the UI, role restrictions, login errors, mobile field screen |

## Running
```bash
# one-time: create the test database and .env.test (DATABASE_URL must point to a database whose name contains "test")
npm test                    # unit + integration (≈10 s)
npm run build
npm run test:e2e            # starts `npm start` on :3000 if nothing is running (reuses a running server)
npx playwright show-report  # HTML report
```
The integration setup runs `prisma migrate deploy` and the idempotent base seed on the test database; it never drops data. Tests create uniquely-named records, so they can be run repeatedly. E2E runs against the database in `.env` (demo seed expected: user `admin`, buyer "M/s Recycle Traders", demo users with `E2E_DEMO_PASSWORD` / `Demo@123`). Set `E2E_ADMIN_PASSWORD` if your admin password differs.

## Required scenarios and where they are tested
| Requirement | Test |
|---|---|
| Create customer | `operations.test.ts › Customer`, E2E step 1 |
| Create pickup | `operations.test.ts › Pickup → schedule → collection`, E2E step 6 |
| Weighment gross 8540, tare 5100 → net 3440 | `rules.test.ts`, `operations.test.ts › Weighment`, E2E steps 10–11 |
| Tare > gross / negative / duplicate / invalid vehicle rejected | `operations.test.ts` |
| Admin-only net override with reason + audit | `operations.test.ts` |
| Input = Output + Rejection + Loss | `rules.test.ts`, `commercial.test.ts › Processing`, E2E step 12 (unbalanced batch is refused first) |
| Sale cannot exceed stock (and rolls back) | `commercial.test.ts › Recyclable sales and inventory` |
| Billing quantity × rate (weight, trip, monthly, rate versions) | `commercial.test.ts › Customer billing`, E2E step 17 |
| Payment reduces outstanding | `commercial.test.ts › Payments and outstanding`, E2E steps 18–19 |
| Unauthorized user cannot act | `commercial.test.ts › Permissions`, `permissions.spec.ts` |
| Modifications create audit records | `operations.test.ts` (create/update/override), E2E step 22 |
| Trial balance stays balanced | `commercial.test.ts › Accounts` |

## Last run (build of this release)
- `npm test`: **3 files, 49 tests passed**
- `npm run test:e2e`: **5 passed** (desktop full flow, 3 permission/auth checks, mobile field screen)
- `npm run typecheck`, `npm run lint`, `npm run build`: clean

## Manual responsive checks
Desktop (1440×900) is the primary layout. The sidebar collapses behind a menu button below 1024 px; tables scroll horizontally inside their card; the **Field Tasks** screen (`/field`) is designed for phones (large buttons, camera capture, GPS) and is verified on a Pixel 7 viewport in `mobile-field.spec.ts` (no horizontal overflow).
