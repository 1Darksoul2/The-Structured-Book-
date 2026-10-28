// Reset a user's password (there is no email service, so this is the "forgot password" path for the server owner).
// Run: node backend/reset-password.js <email> [new-password]   (same DATA_DIR as the server; omit the password to be prompted)
// Signs the user out everywhere.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");

const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const dbFile = path.join(DATA, "journal.db");
const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) { console.error("Usage: node backend/reset-password.js <email> [new-password]"); process.exit(1); }
if (!fs.existsSync(dbFile)) { console.error("No database at " + dbFile + " (set DATA_DIR if the server uses another folder)."); process.exit(1); }

async function main() {
  let pw = process.argv[3];
  if (pw === undefined) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    pw = await new Promise(res => rl.question("New password (min 6 characters): ", a => { rl.close(); res(a); }));
  }
  if (String(pw).length < 6) { console.error("Password needs at least 6 characters."); process.exit(1); }
  const db = new DatabaseSync(dbFile);
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!u) { console.error("No account with that email."); process.exit(1); }
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").run(crypto.scryptSync(String(pw), salt, 64).toString("hex"), salt, u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  console.log("Password updated for " + email + ". They are signed out everywhere.");
}
main();
