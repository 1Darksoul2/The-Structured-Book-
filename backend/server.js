// MyFundedBook backend: JSON API only (no pages). Zero dependencies; needs Node 22.5+ (built-in node:sqlite).
// Run: node backend/server.js   ->  http://localhost:3000
// Auth: Authorization: Bearer <token>. CORS: set ALLOWED_ORIGINS (comma separated) to your frontend's origin(s).
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map(s => s.trim()).filter(Boolean);
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const IMG = path.join(DATA, "images");
fs.mkdirSync(IMG, { recursive: true });

// Secret used to sign short-lived image URLs (so <img> tags work without headers). Persisted across restarts.
const secretFile = path.join(DATA, "secret.key");
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, "utf8").trim();

const db = new DatabaseSync(path.join(DATA, "journal.db"));
db.exec(`
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS journal (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  col TEXT NOT NULL CHECK (col IN ('trades','notes','playbooks','meta')), id TEXT NOT NULL,
  data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, col, id));
`);

const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  addUser: db.prepare("INSERT INTO users (email, name, pw_hash, pw_salt) VALUES (?,?,?,?)"),
  setPw: db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?"),
  addSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)"),
  session: db.prepare("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
  delSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  purge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  rows: db.prepare("SELECT col, id, data FROM journal WHERE user_id = ? ORDER BY col, id LIMIT ? OFFSET ?"),
  upsert: db.prepare("INSERT INTO journal (user_id, col, id, data, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"),
  del: db.prepare("DELETE FROM journal WHERE user_id = ? AND col = ? AND id = ?")
};

const SESSION_MS = 30 * 24 * 3600 * 1000, SIGN_MS = 7 * 24 * 3600 * 1000;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const hmac = s => crypto.createHmac("sha256", SECRET).update(s).digest("hex");
const userOut = u => ({ id: String(u.id), email: u.email, user_metadata: { name: u.name } });
const COLS = new Set(["trades", "notes", "playbooks", "meta"]);
const IMG_RE = /^(\d+)\/([a-f0-9-]{8,64})\.(webp|jpg|png|gif|img)$/;
const MIME = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", gif: "image/gif", img: "application/octet-stream" };

const fails = new Map(); // login throttle: ip|email -> {n, until}
const throttled = key => { const f = fails.get(key); return f && f.n >= 8 && Date.now() < f.until; };
function noteFail(key) { const f = fails.get(key) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 10 * 60 * 1000; fails.set(key, f); }

function send(res, code, body, headers = {}) {
  const isObj = body !== null && typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(code, { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...(isObj ? { "Content-Type": "application/json" } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, code, message) => send(res, code, { error: { message } });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0, over = false;
    // On overflow keep draining (discarding) so the client receives the 413 instead of a connection reset.
    req.on("data", c => { n += c.length; if (over) return; if (n > limit) { over = true; parts.length = 0; reject(Object.assign(new Error("Too large"), { code: 413 })); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}
const readJson = async (req, limit = 5e6) => { const b = await readBody(req, limit); try { return JSON.parse(b.toString() || "{}"); } catch { throw Object.assign(new Error("Bad JSON"), { code: 400 }); } };

const bearer = req => { const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || ""); return m && m[1]; };
const authUser = req => { const t = bearer(req); return t ? q.session.get(sha(t), Date.now()) : null; };
function startSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  q.addSession.run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
const sameSig = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function api(req, res, url) {
  const route = req.method + " " + url.pathname;
  q.purge.run(Date.now());
  if (route === "GET /api/health") return send(res, 200, { ok: true });

  if (route === "POST /api/signup") {
    const b = await readJson(req, 1e4), email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim().slice(0, 80), pw = String(b.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(res, 400, "Enter a valid email.");
    if (pw.length < 6) return fail(res, 400, "Password needs at least 6 characters.");
    if (q.userByEmail.get(email)) return fail(res, 409, "That email is already registered.");
    const salt = crypto.randomBytes(16).toString("hex");
    const id = Number(q.addUser.run(email, name, hashPw(pw, salt), salt).lastInsertRowid);
    return send(res, 200, { user: userOut({ id, email, name }), token: startSession(id) });
  }
  if (route === "POST /api/login") {
    const b = await readJson(req, 1e4), email = String(b.email || "").trim().toLowerCase(), key = req.socket.remoteAddress + "|" + email;
    if (throttled(key)) return fail(res, 429, "Too many attempts. Try again in a few minutes.");
    const u = q.userByEmail.get(email);
    const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ""), u.pw_salt), "hex"), Buffer.from(u.pw_hash, "hex"));
    if (!ok) { noteFail(key); return fail(res, 401, "Invalid login credentials"); }
    fails.delete(key);
    return send(res, 200, { user: userOut(u), token: startSession(u.id) });
  }
  if (route === "POST /api/logout") { const t = bearer(req); if (t) q.delSession.run(sha(t)); return send(res, 200, { ok: true }); }

  // Signed image URL (used by <img>, which cannot send an Authorization header).
  let m = /^\/api\/images\/(\d+\/[^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && m) {
    const p = decodeURIComponent(m[1]), im = IMG_RE.exec(p), exp = +url.searchParams.get("exp"), sig = url.searchParams.get("sig") || "";
    if (!im || !(exp > Date.now()) || !sameSig(sig, hmac(p + "|" + exp))) return fail(res, 403, "Link expired.");
    const file = path.join(IMG, im[1], im[2] + "." + im[3]);
    if (!fs.existsSync(file)) return fail(res, 404, "Not found.");
    return send(res, 200, fs.readFileSync(file), { "Content-Type": MIME[im[3]], "Cache-Control": "private, max-age=86400" });
  }

  const user = authUser(req);
  if (route === "GET /api/me") return send(res, 200, { user: user ? userOut(user) : null });
  if (!user) return fail(res, 401, "Not signed in.");

  if (route === "POST /api/password") {
    const pw = String((await readJson(req, 1e4)).password || ""); if (pw.length < 6) return fail(res, 400, "Password needs at least 6 characters.");
    const salt = crypto.randomBytes(16).toString("hex"); q.setPw.run(hashPw(pw, salt), salt, user.id);
    return send(res, 200, { ok: true });
  }
  if (route === "GET /api/journal") {
    const off = Math.max(0, +url.searchParams.get("offset") || 0), lim = Math.min(1000, Math.max(1, +url.searchParams.get("limit") || 1000));
    return send(res, 200, { rows: q.rows.all(user.id, lim, off).map(r => ({ col: r.col, id: r.id, data: JSON.parse(r.data) })) });
  }
  if (route === "PUT /api/journal") {
    const b = await readJson(req);
    if (!COLS.has(b.col) || typeof b.id !== "string" || !b.id || b.id.length > 100 || !b.data || typeof b.data !== "object") return fail(res, 400, "Bad record.");
    q.upsert.run(user.id, b.col, b.id, JSON.stringify(b.data), new Date().toISOString());
    return send(res, 200, { ok: true });
  }
  m = /^\/api\/journal\/(\w+)\/([^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && m && COLS.has(m[1])) { q.del.run(user.id, m[1], decodeURIComponent(m[2])); return send(res, 200, { ok: true }); }

  // Images: client picks "<userId>/<uuid>.<ext>"; only paths inside the caller's own folder are accepted.
  const own = p => { const im = IMG_RE.exec(p || ""); return im && im[1] === String(user.id) ? im : null; };
  if (route === "POST /api/images") {
    const p = url.searchParams.get("path"), im = own(p); if (!im) return fail(res, 400, "Bad image path.");
    const body = await readBody(req, 12e6); if (!body.length) return fail(res, 400, "Empty upload.");
    fs.mkdirSync(path.join(IMG, im[1]), { recursive: true });
    fs.writeFileSync(path.join(IMG, im[1], im[2] + "." + im[3]), body);
    return send(res, 200, { path: p });
  }
  if (route === "POST /api/images/sign") {
    const p = (await readJson(req, 1e4)).path, im = own(p); if (!im) return fail(res, 404, "Not found.");
    const exp = Date.now() + SIGN_MS;
    return send(res, 200, { url: `/api/images/${p}?exp=${exp}&sig=${hmac(p + "|" + exp)}` });
  }
  m = /^\/api\/images\/(\d+\/[^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && m) {
    const im = own(decodeURIComponent(m[1])); if (!im) return fail(res, 404, "Not found.");
    fs.rmSync(path.join(IMG, im[1], im[2] + "." + im[3]), { force: true });
    return send(res, 200, { ok: true });
  }
  return fail(res, 404, "Not found.");
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin"); // always, or a cached <img> response (no Origin) gets reused by a later CORS fetch and fails
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"); res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return fail(res, 404, "API only. The frontend is served separately.");
    await api(req, res, url);
  } catch (e) {
    if (!res.headersSent) { if (e.code === 413) res.setHeader("Connection", "close"); fail(res, e.code === 413 || e.code === 400 ? e.code : 500, e.code === 413 ? "Too large." : e.code === 400 ? e.message : "Server error."); }
    if (!e.code) console.error(e);
  }
}).listen(PORT, HOST, () => console.log(`MyFundedBook API on http://localhost:${PORT}  (allowed origins: ${ORIGINS.join(", ")})`));
