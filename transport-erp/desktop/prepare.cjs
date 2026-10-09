/**
 * Copies the built ERP (server + web + database migrations) into this folder so electron-builder can package it.
 * Run from the desktop folder:  npm run prepare-app
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const run = (cmd, cwd) => { console.log(`> ${cmd}`); execSync(cmd, { cwd, stdio: "inherit" }); };

run("npm run build", root);
for (const d of ["server-dist", "web", "prisma"]) fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });
fs.cpSync(path.join(root, "dist/server"), path.join(__dirname, "server-dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "server-dist/package.json"), JSON.stringify({ type: "module" }));
fs.cpSync(path.join(root, "dist/web"), path.join(__dirname, "web"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "prisma"), { recursive: true });
fs.copyFileSync(path.join(root, "prisma/schema.prisma"), path.join(__dirname, "prisma/schema.prisma"));
fs.cpSync(path.join(root, "prisma/migrations"), path.join(__dirname, "prisma/migrations"), { recursive: true });
run("npx prisma generate --schema prisma/schema.prisma", __dirname);
console.log("Desktop app prepared.");
