/**
 * VENDOR ONLY. Creates a new Ed25519 key pair for signing licence keys.
 *   npm run license:keygen
 * Writes licence-private.pem (KEEP SECRET, never commit, never ship) and prints the public key,
 * which must be pasted into src/server/license.ts (VENDOR_PUBLIC_KEY_PEM) before building the app.
 */
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";

const out = process.argv[2] || "licence-private.pem";
if (fs.existsSync(out)) {
  console.error(`${out} already exists. Refusing to overwrite your private key.`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
console.log(`Private key written to ${out}. Keep it safe and secret.\n`);
console.log("Public key (put this in src/server/license.ts -> VENDOR_PUBLIC_KEY_PEM):\n");
console.log(publicKey.export({ type: "spki", format: "pem" }));
