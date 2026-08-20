import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 8005);
const targets = {
  qwen: "http://127.0.0.1:8002",
  qwen38: "http://127.0.0.1:8006",
  muse: "http://127.0.0.1:8004",
};
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function proxy(req, res, model) {
  const target = targets[model];
  if (!target) {
    log(`[404] Unknown model target: ${model}`);
    return json(res, 404, { error: "Unknown model target" });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  let summary = `model=${model} bytes=${rawBody.length}`;
  try {
    const parsed = JSON.parse(rawBody.toString('utf-8'));
    const lastMsg = parsed.messages?.[parsed.messages.length - 1];
    const isArray = Array.isArray(lastMsg?.content);
    const imgCount = isArray ? lastMsg.content.filter(c => c.type === 'image_url').length : 0;
    summary += ` stream=${parsed.stream} images=${imgCount}`;
  } catch {}

  log(`--> POST /api/${model}/chat (${summary})`);

  try {
    const upstream = await fetch(`${target}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

    log(`<-- Upstream ${target} returned HTTP ${upstream.status}`);

    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    let sentBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sentBytes += value.length;
      if (!res.write(value)) await new Promise(resolve => res.once("drain", resolve));
    }
    res.end();
    log(`[DONE] /api/${model}/chat completed (${sentBytes} bytes streamed)`);
  } catch (error) {
    log(`[ERROR] /api/${model}/chat failed: ${error.message}`);
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
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control":"no-store, no-cache, must-revalidate" });
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
  const match = url.pathname.match(/^\/api\/(qwen|qwen38|muse)\/chat$/);
  if (req.method === "POST" && match) return proxy(req, res, match[1]);
  if (req.method === "GET") return serve(res, decodeURIComponent(url.pathname));
  json(res, 405, { error: "Method not allowed" });
}).listen(port, "0.0.0.0", () => log(`Compare console listening on :${port}`));
