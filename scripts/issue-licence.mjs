// Vendor tool: create a signed licence key for a customer.
// Needs the vendor's private key file (licence-private.pem), which must NEVER be given to customers.
// Usage: node scripts/issue-licence.mjs                     (asks questions)
//        node scripts/issue-licence.mjs --licensee "ABC Recyclers" --gstin 33ABCDE1234F1Z5 --expires 2027-10-31 --users 10 --key D:\keys\licence-private.pem
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);

const keyFile = [args.key, process.env.GCERP_LICENCE_KEY_FILE, "licence-private.pem", join(homedir(), "licence-private.pem"), join(homedir(), "Documents", "licence-private.pem"), join(homedir(), "Desktop", "licence-private.pem")].find((f) => f && existsSync(f));
if (!keyFile) {
  console.error("\nPrivate key file 'licence-private.pem' not found.\nPut it in your Documents folder, or pass --key <path>.\n");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def) => (args[q.key] ?? ((await rl.question(`${q.text}${def ? ` [${def}]` : ""}: `)).trim() || def || ""));

const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const licensee = await ask({ key: "licensee", text: "Customer company name" });
const gstin = (await ask({ key: "gstin", text: "Customer GSTIN (exactly as in their Company Profile; leave blank for any)" })).toUpperCase();
const expires = await ask({ key: "expires", text: "Valid until (YYYY-MM-DD)" }, nextYear);
const users = await ask({ key: "users", text: "Maximum active users (blank = unlimited)" });
rl.close();

if (!licensee) throw new Error("Customer name is required.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires))) throw new Error("Date must look like 2027-10-31.");
if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("GSTIN must be 15 characters.");
if (users && !/^\d+$/.test(users)) throw new Error("Users must be a whole number.");

const payload = { v: 1, id: randomUUID(), licensee, ...(gstin ? { gstin } : {}), ...(users ? { users: Number(users) } : {}), issued: new Date().toISOString().slice(0, 10), expires };
const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = sign(null, Buffer.from(body), createPrivateKey(readFileSync(keyFile))).toString("base64url");
const key = `GCERP-${body}.${sig}`;

mkdirSync("licences", { recursive: true });
const file = join("licences", `${licensee.replace(/[^A-Za-z0-9]+/g, "-")}_${expires}.txt`);
writeFileSync(file, `Customer : ${licensee}\nGSTIN    : ${gstin || "any"}\nUsers    : ${users || "unlimited"}\nValid to : ${expires}\nIssued   : ${payload.issued}\nLicence ID: ${payload.id}\n\n${key}\n`);
console.log(`\nLicence key for ${licensee} (valid until ${expires}):\n\n${key}\n\nSaved to ${file}\nSend this key to the customer. They paste it in Settings → Licence.\n`);
