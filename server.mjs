import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 8005);
const targets = {
  qwen: "http://127.0.0.1:8002",
  muse: "http://127.0.0.1:8004",
};
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function proxy(req, res, model) {
  const target = targets[model];
  if (!target) return json(res, 404, { error: "Unknown model target" });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    const upstream = await fetch(`${target}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    });
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise(resolve => res.once("drain", resolve));
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) json(res, 502, { error: error.message }); else res.end();
  }
}

async function serve(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return json(res, 403, { error: "Forbidden" });
  try {
    if (!(await stat(file)).isFile()) throw new Error("Not a file");
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control":"no-cache" });
    res.end(data);
  } catch { json(res, 404, { error: "Not found" }); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/api/health") {
    const checks = await Promise.all(Object.entries(targets).map(async ([name, base]) => {
      try { return [name, (await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })).ok]; }
      catch { return [name, false]; }
    }));
    return json(res, 200, Object.fromEntries(checks));
  }
  const match = url.pathname.match(/^\/api\/(qwen|muse)\/chat$/);
  if (req.method === "POST" && match) return proxy(req, res, match[1]);
  if (req.method === "GET") return serve(res, decodeURIComponent(url.pathname));
  json(res, 405, { error: "Method not allowed" });
}).listen(port, "0.0.0.0", () => console.log(`Compare console listening on :${port}`));
