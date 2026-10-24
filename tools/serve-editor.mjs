// Fixed-address static server for dist/, so the editor opens like the WH2 page
// (https://imrz.github.io/tww2-campaign-editor/) without a dev server.
// File System Access needs http://127.0.0.1, not a file:// page.
import { exec } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 5173;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const page = `http://${HOST}:${PORT}/`;

function openBrowser() {
  exec(`start "" "${page}"`);
}

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("dist/index.html is missing. Run npm run build first.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", page);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    openBrowser();
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(page);
  if (process.argv.includes("--open")) openBrowser();
});
