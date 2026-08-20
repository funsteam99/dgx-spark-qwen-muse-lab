import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 8005);
const targets = {
  qwen: "http://127.0.0.1:8002",
  qwen38: "http://127.0.0.1:8006",
  muse: "http://127.0.0.1:8004",
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

// Model-isolated dynamic skills registry: Map<modelKey, Map<skill_name, skillObj>>
const modelSkills = new Map([
  ["qwen", new Map()],
  ["qwen38", new Map()],
  ["muse", new Map()]
]);

function getModelSkillMap(modelKey) {
  if (!modelSkills.has(modelKey)) {
    modelSkills.set(modelKey, new Map());
  }
  return modelSkills.get(modelKey);
}

// Built-in tool definitions
const baseToolDefs = [
  {
    type: "function",
    function: {
      name: "create_skill",
      description: "當你發現現有工具無法滿足需求時，自定義編寫一個 Python 函式並註冊為可重複調用的 Skill。建立後系統會即時加載，讓你在下個步驟立即調用！",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "小寫英數底線的技能名稱，例如: calc_haversine_distance, parse_log_stats"
          },
          description: {
            type: "string",
            description: "該 Skill 的用途說明與參數解釋"
          },
          python_code: {
            type: "string",
            description: "包含完整 import、型別註解與 docstring 的 Python 程式碼，需定義與 skill_name 同名的主要函式"
          },
          parameters_schema: {
            type: "object",
            description: "該函式的 JSON Schema 參數規格定義 (含 type, properties, required)"
          }
        },
        required: ["skill_name", "description", "python_code", "parameters_schema"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "python_repl",
      description: "在 Python 沙盒環境中執行代碼並獲取輸出 stdout/stderr 或回傳值",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "要執行的 Python 腳本"
          }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜尋網路最新公開資訊",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜尋關鍵字"
          }
        },
        required: ["query"]
      }
    }
  }
];

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function runPythonSnippet(code, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const py = spawn("python3", ["-c", code]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      py.kill("SIGKILL");
      resolve({ success: false, output: "Execution timed out (10s)" });
    }, timeoutMs);

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || "(No stdout output)" });
      } else {
        resolve({ success: false, output: (stderr || stdout || `Process exited with code ${code}`).trim() });
      }
    });

    py.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: err.message });
    });
  });
}

// Execute Tool Call within Model's Isolated Scope
async function executeTool(modelKey, name, args) {
  log(`[TOOL-EXEC][${modelKey}] Executing: ${name} with args: ${JSON.stringify(args)}`);
  const mySkills = getModelSkillMap(modelKey);

  if (name === "create_skill") {
    const { skill_name, description, python_code, parameters_schema } = args;
    if (!skill_name || !python_code) {
      return JSON.stringify({ error: "Missing skill_name or python_code" });
    }
    // Test compile the python code
    const testCode = `${python_code}\nimport inspect\nassert "${skill_name}" in globals(), "Main function '${skill_name}' not defined"\nprint("VALID_SKILL")\n`;
    const testRes = await runPythonSnippet(testCode);
    if (!testRes.success || !testRes.output.includes("VALID_SKILL")) {
      return JSON.stringify({
        error: `Skill 語法或定義檢查失敗：${testRes.output}`,
        suggestion: "請檢查 Python 程式碼語法是否正確，並確保函式名稱與 skill_name 一致"
      });
    }

    // Save to model's isolated dynamic skills registry
    mySkills.set(skill_name, {
      name: skill_name,
      model: modelKey,
      description: description || "自建 Skill",
      code: python_code,
      schema: parameters_schema || { type: "object", properties: {} },
      createdAt: new Date().toISOString()
    });

    return JSON.stringify({
      status: "SUCCESS",
      message: `✨ Skill '${skill_name}' 已成功編譯並註冊至 [${modelKey}] 專屬工具庫！下個步驟可直接呼叫。`,
      skill_name,
      model: modelKey
    });
  }

  if (name === "python_repl") {
    const res = await runPythonSnippet(args.code || "");
    return JSON.stringify({
      success: res.success,
      output: res.output
    });
  }

  if (name === "web_search") {
    const q = encodeURIComponent(args.query || "");
    try {
      const resp = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      const abstract = data.AbstractText || "";
      const related = (data.RelatedTopics || []).slice(0, 3).map(r => r.Text).filter(Boolean);
      return JSON.stringify({
        query: args.query,
        abstract: abstract || "無直接摘要",
        related: related.length ? related : ["無相關即時條目"]
      });
    } catch (e) {
      return JSON.stringify({ query: args.query, result: `搜尋服務暫時無法連線: ${e.message}` });
    }
  }

  // Check model's isolated custom skills
  if (mySkills.has(name)) {
    const skill = mySkills.get(name);
    const runnerCode = `
import json
${skill.code}

kwargs = json.loads(${JSON.stringify(JSON.stringify(args))})
result = ${name}(**kwargs)
print(json.dumps({"result": result}, ensure_ascii=False, default=str))
`;
    const res = await runPythonSnippet(runnerCode);
    if (!res.success) {
      return JSON.stringify({
        error: `執行動態 Skill '${name}' 發生異常: ${res.output}`,
        status: "FAILED"
      });
    }
    return res.output;
  }

  return JSON.stringify({ error: `Tool '${name}' not found in [${modelKey}] scope` });
}

// Agentic ReAct Multi-turn Streaming Proxy
async function proxyAgent(req, res, modelKey, parsed) {
  const target = targets[modelKey];
  if (!target) return json(res, 404, { error: "Unknown model target" });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  });

  const sendSSE = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const messages = [...(parsed.messages || [])];
  const maxTurns = 6;
  let turn = 0;
  let isDone = false;
  const mySkills = getModelSkillMap(modelKey);

  const getTools = () => {
    const tools = [...baseToolDefs];
    for (const [name, skill] of mySkills.entries()) {
      tools.push({
        type: "function",
        function: {
          name: skill.name,
          description: skill.description,
          parameters: skill.schema
        }
      });
    }
    return tools;
  };

  log(`[AGENT-START][${modelKey}] agent loop initiated (max_turns=${maxTurns}, active_skills=${mySkills.size})`);

  while (turn < maxTurns && !isDone) {
    turn++;
    log(`[AGENT-TURN][${modelKey}] Turn ${turn}/${maxTurns}`);

    const payload = {
      model: parsed.model,
      messages: messages,
      tools: getTools(),
      stream: true,
      max_tokens: parsed.max_tokens || 4096,
      temperature: parsed.temperature ?? 0.2,
      ...(parsed.chat_template_kwargs ? { chat_template_kwargs: parsed.chat_template_kwargs } : {}),
      ...(parsed.repetition_penalty ? { repetition_penalty: parsed.repetition_penalty } : {})
    };

    let upstream;
    try {
      upstream = await fetch(`${target}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120 * 1000)
      });
    } catch (err) {
      sendSSE({ choices: [{ delta: { content: `\n[Agent Error: ${err.message}]` } }] });
      break;
    }

    if (!upstream.ok) {
      const errText = await upstream.text();
      sendSSE({ choices: [{ delta: { content: `\n[Upstream HTTP ${upstream.status}: ${errText}]` } }] });
      break;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let toolCallAcc = {};
    let turnReasoning = "";
    let turnContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const chunk = JSON.parse(raw);
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Forward chunk to client UI
          sendSSE(chunk);

          const delta = choice.delta || {};
          if (delta.reasoning || delta.reasoning_content) {
            turnReasoning += (delta.reasoning || delta.reasoning_content);
          }
          if (delta.content) {
            turnContent += delta.content;
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              if (!toolCallAcc[idx]) {
                toolCallAcc[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: "", args: "" };
              }
              if (tc.id) toolCallAcc[idx].id = tc.id;
              if (tc.function?.name) toolCallAcc[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallAcc[idx].args += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    const calls = Object.values(toolCallAcc).filter(c => c.name);
    if (calls.length === 0) {
      log(`[AGENT-DONE][${modelKey}] Model finished without further tool calls`);
      isDone = true;
      break;
    }

    // Append Assistant Message with Tool Calls
    const assistantMsg = {
      role: "assistant",
      content: turnContent || null,
      tool_calls: calls.map(c => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args }
      }))
    };
    if (turnReasoning) assistantMsg.reasoning = turnReasoning;
    messages.push(assistantMsg);

    // Execute each tool call in model's scope
    for (const call of calls) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(call.args);
      } catch (e) {
        parsedArgs = { raw: call.args };
      }

      sendSSE({
        agent_step: {
          type: "tool_executing",
          model: modelKey,
          name: call.name,
          call_id: call.id,
          args: parsedArgs
        }
      });

      const resultStr = await executeTool(modelKey, call.name, parsedArgs);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultStr
      });

      sendSSE({
        agent_step: {
          type: "tool_result",
          model: modelKey,
          name: call.name,
          call_id: call.id,
          result: resultStr,
          skills_count: mySkills.size
        }
      });
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
  log(`[AGENT-COMPLETE][${modelKey}] workflow ended.`);
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

  let parsed = null;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch {}

  if (parsed?.agent_mode) {
    log(`--> POST /api/${model}/chat [AGENT MODE ACTIVATED]`);
    return proxyAgent(req, res, model, parsed);
  }

  log(`--> POST /api/${model}/chat (Direct stream)`);

  try {
    const upstream = await fetch(`${target}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });

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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise(resolve => res.once("drain", resolve));
    }
    res.end();
  } catch (error) {
    log(`[ERROR] /api/${model}/chat failed: ${error.message}`);
    if (!res.headersSent) json(res, 502, { error: error.message }); else res.end();
  }
}

async function serve(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return json(res, 403, { error: "Forbidden" });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "content-length": st.size,
      "cache-control": "no-cache"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const data = await readFile(file);
    res.end(data);
  } catch { json(res, 404, { error: "Not found" }); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/health") {
    const checks = await Promise.all(Object.entries(targets).map(async ([name, base]) => {
      try { return [name, (await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })).ok]; }
      catch { return [name, false]; }
    }));
    return json(res, 200, Object.fromEntries(checks));
  }

  // Get skills by model or all models
  if (req.method === "GET" && url.pathname === "/api/skills") {
    const allCustom = [];
    for (const [mKey, sMap] of modelSkills.entries()) {
      for (const s of sMap.values()) {
        allCustom.push(s);
      }
    }
    return json(res, 200, {
      built_in: baseToolDefs.map(t => t.function),
      custom_skills: allCustom,
      by_model: {
        qwen: Array.from(modelSkills.get("qwen")?.values() || []),
        qwen38: Array.from(modelSkills.get("qwen38")?.values() || []),
        muse: Array.from(modelSkills.get("muse")?.values() || [])
      }
    });
  }

  // Delete/reset skills
  if (req.method === "DELETE" && url.pathname === "/api/skills") {
    const m = url.searchParams.get("model");
    if (m && modelSkills.has(m)) {
      modelSkills.get(m).clear();
    } else {
      for (const map of modelSkills.values()) map.clear();
    }
    return json(res, 200, { ok: true, message: m ? `${m} skills cleared` : "All skills cleared" });
  }

  const match = url.pathname.match(/^\/api\/(qwen|qwen38|muse)\/chat$/);
  if (req.method === "POST" && match) return proxy(req, res, match[1]);
  if (req.method === "GET" || req.method === "HEAD") return serve(req, res, decodeURIComponent(url.pathname));
  json(res, 405, { error: "Method not allowed" });
}).listen(port, "0.0.0.0", () => log(`Splitframe Agentic Server listening on :${port}`));
