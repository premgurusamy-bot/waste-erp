/**
 * VENDOR ONLY. Issue a signed licence key.
 *   npm run license:issue -- --company "G Road Lines" --plan YEARLY --start 2026-10-08 --expiry 2027-10-07 \
 *        [--machine GRL-XXXX-XXXX-XXXX-XXXX] [--users 5] [--key licence-private.pem]
 * PERPETUAL plan: omit --expiry.
 */
import { createPrivateKey, sign, randomUUID } from "node:crypto";
import fs from "node:fs";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const company = arg("company");
const plan = (arg("plan") || "YEARLY").toUpperCase();
const start = arg("start") || new Date().toISOString().slice(0, 10);
const expiry = plan === "PERPETUAL" ? null : arg("expiry");
if (!company || !["TRIAL", "MONTHLY", "YEARLY", "PERPETUAL"].includes(plan) || (plan !== "PERPETUAL" && !expiry)) {
  console.error("Usage: --company <name> --plan TRIAL|MONTHLY|YEARLY|PERPETUAL --start YYYY-MM-DD --expiry YYYY-MM-DD [--machine ID] [--users N]");
  process.exit(1);
}
const payload = {
  v: 1,
  licenseId: `LIC-${randomUUID().slice(0, 8).toUpperCase()}`,
  company,
  machineId: arg("machine") || null,
  plan,
  startDate: start,
  expiryDate: expiry,
  maxUsers: arg("users") ? Number(arg("users")) : null,
};
const key = createPrivateKey(fs.readFileSync(arg("key") || "licence-private.pem"));
const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = sign(null, Buffer.from(body), key).toString("base64url");
const licence = `GRL1.${body}.${sig}`;
fs.mkdirSync("licences", { recursive: true });
fs.writeFileSync(`licences/${payload.licenseId}.txt`, `${JSON.stringify(payload, null, 2)}\n\n${licence}\n`);
console.log(JSON.stringify(payload, null, 2));
console.log("\nLICENCE KEY:\n" + licence);
