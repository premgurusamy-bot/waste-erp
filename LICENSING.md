# Licensing (vendor guide)

GreenCycle ERP is installed on the customer's own computer. The customer owns and looks after its data.
The customer pays for a licence period (normally one year) and you send a new key to renew.

## How it works

| Situation | What the customer sees | Can they save? |
|---|---|---|
| New install, no key | Amber banner "Trial licence: N day(s) left" (30 days) | Yes |
| Key valid, more than 30 days left | Nothing | Yes |
| 30 days or fewer left | Amber banner with the expiry date | Yes |
| Expired up to 15 days ago | Red banner, grace period | Yes |
| Expired more than 15 days ago | Red banner, **view-only** | No, but they can view, print and export everything |
| Key for another GSTIN | Red banner, view-only | No |
| Computer date turned back | Red banner, view-only until the date is corrected | No |

A key can also limit the number of **active users**.

Keys are signed with your **private key** (`licence-private.pem`). The app contains only the matching public key,
so nobody can make a key without your private key, and editing a key breaks its signature.

## Your private key

- Keep `licence-private.pem` in your **Documents** folder on your own computer, plus one backup copy
  (a USB drive kept safe, or a password manager).
- **Never** send it to a customer, never put it in the GitHub repo (it is blocked by `.gitignore`), never email it.
- If you lose it you cannot issue keys for the current version. If someone else gets it, they can make keys:
  tell your developer to replace the key pair and ship an update.

## Issue or renew a key

1. Ask the customer for the **GSTIN** exactly as it appears in their **Settings → Company Profile**.
2. On your computer, in the waste-erp folder, double-click **ISSUE-LICENCE.bat**.
3. Answer the questions: customer name, GSTIN, valid-until date (e.g. `2027-10-31`), maximum users (blank = unlimited).
4. Copy the key it prints (it is also saved in the `licences` folder) and send it to the customer.
5. The customer's administrator opens **Settings → Licence**, pastes the key and clicks **Install Licence**.

Renewal is the same: issue a new key with a later date. The new key replaces the old one and no data changes.

## Installing at a new customer

1. Run the normal setup (`SETUP-WINDOWS.bat`).
2. Sign in as admin, open **Settings → Company Profile** and enter the customer's real name and GSTIN.
3. Issue a key for that GSTIN and install it under **Settings → Licence**.

## Limits

The licence check stops casual copying and stops a customer from using the app after they stop paying.
A customer who has the **source code** and a programmer could remove the check. To make that much harder,
give customers only the built application (not the source) and rely on the `LICENSE` agreement they accept.
