/**
 * Server statis kecil untuk preview Saklar (frontend saja).
 * Backend aslinya adalah Google Apps Script — lihat folder appsscript/.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, "config", "api-config.json");

function readApiConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { api_url: null };
  }
}

function writeApiConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".gs": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  // ---- API kecil: simpan/muat URL backend Apps Script ----
  if (urlPath === "/api/load-config" && req.method === "GET") {
    const cfg = readApiConfig();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, api_url: cfg.api_url || null }));
  }
  if (urlPath === "/api/save-config" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const url = String(parsed.api_url || "").trim();
        if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "URL tidak valid." }));
        }
        writeApiConfig({ api_url: url });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Body tidak valid." }));
      }
    });
    return;
  }

  if (urlPath === "/") urlPath = "/index.html";

  // Cegah path traversal
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback ke index.html untuk path tak dikenal
      fs.readFile(path.join(ROOT, "index.html"), (err2, index) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("404 Not Found");
        }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(index);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Saklar frontend berjalan di http://${HOST}:${PORT}`);
});
