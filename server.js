"use strict";
// Zero-dependency local server: serves the app and stores data in data/data.json
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const MAX_BODY = 1024 * 1024;

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      reminders: Array.isArray(d.reminders) ? d.reminders : [],
      contacts: Array.isArray(d.contacts) ? d.contacts : [],
    };
  } catch {
    return { reminders: [], contacts: [] };
  }
}

function handleApi(req, res) {
  if (req.method === "GET") return send(res, 200, JSON.stringify(readData()), "application/json");
  if (req.method !== "PUT") return send(res, 405, "Method not allowed");

  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, "Too large"); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let d;
    try { d = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, "Invalid JSON"); }
    if (!d || !Array.isArray(d.reminders) || !Array.isArray(d.contacts)) return send(res, 400, "Expected {reminders:[], contacts:[]}");
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ reminders: d.reminders, contacts: d.contacts }, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error(e);
      return send(res, 500, "Write failed");
    }
    send(res, 200, "{}", "application/json");
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/data") return handleApi(req, res);
  const entry = STATIC[pathname];
  if (!entry || req.method !== "GET") return send(res, 404, "Not found");
  fs.readFile(path.join(ROOT, entry[0]), (err, buf) => (err ? send(res, 500, "Read failed") : send(res, 200, buf, entry[1])));
}).listen(PORT, "127.0.0.1", () => console.log(`Notes & Reminders: http://localhost:${PORT}  (data: ${DATA_FILE})`));
