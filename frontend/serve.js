// Tiny static file server for local development of the frontend. Any static host works instead.
// Run: node frontend/serve.js   ->  http://localhost:5173
"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const PORT = +process.env.PORT || 5173, ROOT = __dirname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname, rel = p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, "");
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || file === __filename || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log(`Frontend on http://localhost:${PORT}`));
