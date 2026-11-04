// Serves the built app (dist/) at http://localhost:5173/ and opens the browser. Plain Node.js, no packages:
// no `npm install`, and none of the development server's on-the-fly bundling (which Windows antivirus or
// folder sync can lock: "EBUSY ... node_modules\.vite\deps").
//   node tools/serve.mjs              serve dist/ on port 5173 (the next free port when it is taken)
//   node tools/serve.mjs --no-open    do not open the browser
//   node tools/serve.mjs --port 8080  another port
// Only this computer can reach it (it listens on 127.0.0.1).
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const args = process.argv.slice(2);
const open = !args.includes("--no-open");
const portArg = args.indexOf("--port");
const FIRST = portArg >= 0 ? Number(args[portArg + 1]) : 5173;
const ID = "pcs-platform";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".webmanifest": "application/manifest+json",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`The built app is missing (${join(ROOT, "index.html")}). Run "npm install" and "npm run build" first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
  if (path === "/__pcs") { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ app: ID, root: ROOT })); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
  let file = resolve(ROOT, `.${path}`);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); } catch { /* not found below */ }
  let size;
  try { const st = statSync(file); if (!st.isFile()) throw new Error(); size = st.size; } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found"); return; }
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Pages are checked again on every load (a new version is picked up); the hashed files can be cached.
  const cache = type.startsWith("text/html") ? "no-cache" : /[.-][0-9a-zA-Z_-]{8,}\.(js|wasm|css)$/.test(file) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
});

/** What answers on a port: this app (and from which folder), something else, or nothing. */
function probe(port) {
  return new Promise((done) => {
    const r = http.get({ host: "127.0.0.1", port, path: "/__pcs", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { const j = JSON.parse(body); done(j.app === ID ? { ours: true, root: j.root } : { ours: false }); } catch { done({ ours: false }); } });
    });
    r.on("timeout", () => { r.destroy(); done({ ours: false }); });
    r.on("error", () => done(null));
  });
}

function openBrowser(url) {
  if (!open) return;
  const [cmd, cmdArgs] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, cmdArgs, { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* the address is printed */ }
}

function listen(port) {
  return new Promise((ok, fail) => {
    const onError = (e) => { server.off("listening", onListening); fail(e); };
    const onListening = () => { server.off("error", onError); ok(port); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

for (let port = FIRST; port < FIRST + 20; port++) {
  try {
    await listen(port);
    const url = `http://localhost:${port}/`;
    console.log(`PCS Platform is running at ${url}`);
    console.log("Keep this window open while you use the app. Close it (or press Ctrl+C) to stop.");
    if (port !== FIRST) console.log(`(Port ${FIRST} was taken, so this is ${port}. Work saved in the browser is kept per address: what you did at another address is still there, or use Save to file / Open.)`);
    openBrowser(url);
    break;
  } catch (e) {
    if (e.code !== "EADDRINUSE") { console.error(`Could not start: ${e.message}`); process.exit(1); }
    const who = await probe(port);
    if (who?.ours && who.root === ROOT) {
      console.log(`PCS Platform from this folder is already running at http://localhost:${port}/ — opening it.`);
      openBrowser(`http://localhost:${port}/`);
      process.exit(0);
    }
    if (who?.ours) console.log(`Another PCS Platform folder is running at port ${port} (${who.root}). This one uses the next port; close the other window when you no longer need it.`);
  }
  if (port === FIRST + 19) { console.error(`No free port between ${FIRST} and ${FIRST + 19}.`); process.exit(1); }
}
