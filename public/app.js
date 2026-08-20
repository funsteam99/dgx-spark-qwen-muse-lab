const modelDefs = {
  qwen: {
    key: "qwen",
    name: "Qwen 3.6",
    desc: "原生多模態 · MTP speculative · Tool Calling",
    model: "nvidia/Qwen3.6-35B-A3B-NVFP4",
    context: "<b>256K</b> context",
    draft: "<b>3</b> MTP draft",
    icon: "Q3.6",
    className: "qwen",
    placeholder: "問 Qwen 3.6…（可貼上或拖入圖片，支援 Agent 任務）",
    emptyCopy: "支援 Agent 工具調用與動態自建 Skill。<br>或開啟同步，讓兩邊對決同一個任務。",
    defaultThinking: false,
    repetitionPenalty: 1.08
  },
  qwen38: {
    key: "qwen38",
    name: "Qwen 3.8",
    desc: "27B NVFP4 · 視覺推理增強 · Tool Calling",
    model: "qwen3.8",
    context: "<b>128K</b> context",
    draft: "<b>3</b> MTP draft",
    icon: "Q3.8",
    className: "qwen38",
    placeholder: "問 Qwen 3.8…（可貼上或拖入圖片，支援 Agent 任務）",
    emptyCopy: "同一個 Agent 任務、同一個目標。<br>直接比較規劃能力、自建 Skill 與代碼執行。",
    defaultThinking: true,
    repetitionPenalty: null
  },
  muse: {
    key: "muse",
    name: "Muse Glimmer",
    desc: "GGUF vision · DFlash accelerated",
    model: "muse-glimmer-30B",
    context: "<b>32K</b> context",
    draft: "<b>15</b> DFlash draft",
    icon: "M",
    className: "muse",
    placeholder: "問 Muse…（可貼上或拖入圖片）",
    emptyCopy: "同一張圖、同一個問題。<br>直接比較細節、推理與速度。",
    defaultThinking: false,
    repetitionPenalty: null
  }
};

const state = {
  left: { modelKey: "qwen", thinking: false, history: [], images: [], busy: false, controller: null },
  right: { modelKey: "qwen38", thinking: true, history: [], images: [], busy: false, controller: null }
};

const $ = (sel, root = document) => root.querySelector(sel);
const lanes = {
  left: $('[data-side="left"]'),
  right: $('[data-side="right"]')
};

if (window.mermaid) {
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'loose',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang TC", sans-serif'
    });
  } catch (e) {
    console.warn('Mermaid initialize warning:', e);
  }
}

if (window.marked) {
  try {
    const customRenderer = {
      code(arg1, arg2) {
        const codeText = typeof arg1 === 'object' ? (arg1.text || '') : String(arg1 || '');
        const lang = (typeof arg1 === 'object' ? (arg1.lang || '') : String(arg2 || '')).trim().toLowerCase();

        if (lang === 'mermaid') {
          return `<div class="mermaid-diagram"><div class="mermaid">${escapeHtml(codeText)}</div></div>`;
        }
        return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(codeText)}</code></pre>`;
      }
    };
    marked.use({ renderer: customRenderer, gfm: true, breaks: true });
  } catch (e) {
    console.warn('Marked configuration warning:', e);
  }
}

function toast(text) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el.t);
  el.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMarkdownToHtml(text = '') {
  const mathBlocks = [];
  const codeBlocks = [];

  let processed = String(text).replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const placeholder = `%%CODEBLOCK${codeBlocks.length}%%`;
    codeBlocks.push(match);
    return placeholder;
  });

  processed = processed.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g, (match, p1, p2) => {
    const math = p1 !== undefined ? p1 : p2;
    const placeholder = `%%MATHDISPLAY${mathBlocks.length}%%`;
    mathBlocks.push({ math: math.trim(), display: true });
    return placeholder;
  });

  processed = processed.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$|\\\(([\s\S]*?)\\\)/g, (match, p1, p2) => {
    const math = p1 !== undefined ? p1 : p2;
    if (!math.trim()) return match;
    const placeholder = `%%MATHINLINE${mathBlocks.length}%%`;
    mathBlocks.push({ math: math.trim(), display: false });
    return placeholder;
  });

  processed = processed.replace(/%%CODEBLOCK(\d+)%%/g, (_, idx) => codeBlocks[Number(idx)]);

  let html = '';
  if (window.marked && typeof marked.parse === 'function') {
    try {
      html = marked.parse(processed);
    } catch (e) {
      console.warn('Marked parse error:', e);
      html = renderFallbackText(processed);
    }
  } else {
    html = renderFallbackText(processed);
  }

  html = html.replace(/%%MATH(DISPLAY|INLINE)(\d+)%%/g, (match, type, idx) => {
    const item = mathBlocks[Number(idx)];
    if (!item) return match;
    if (window.katex && typeof katex.renderToString === 'function') {
      try {
        return katex.renderToString(item.math, {
          displayMode: item.display,
          throwOnError: false
        });
      } catch (err) {
        console.warn('KaTeX render error:', err);
        return item.display ? `<div class="katex-error">$$${escapeHtml(item.math)}$$</div>` : `<span class="katex-error">$${escapeHtml(item.math)}$</span>`;
      }
    }
    return item.display ? `$$${escapeHtml(item.math)}$$` : `$${escapeHtml(item.math)}$`;
  });

  return html;
}

function renderFallbackText(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n'), html = [];
  let code = false, codeLang = '', codeLines = [], list = '';
  const closeList = () => { if (list) { html.push(`</${list}>`); list = ''; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)/);
    if (fence) {
      if (code) {
        html.push(`<pre><code${codeLang ? ` data-language="${escapeHtml(codeLang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        code = false; codeLines = []; codeLang = '';
      } else {
        closeList(); code = true; codeLang = fence[1] || ''; codeLines = [];
      }
      continue;
    }
    if (code) { codeLines.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); html.push(`<h${h[1].length}>${escapeHtml(h[2])}</h${h[1].length}>`); continue; }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${escapeHtml(ul[1])}</li>`); continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${escapeHtml(ol[2])}</li>`); continue; }
    closeList(); html.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (code) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  closeList(); return html.join('');
}

function applyMermaid(container) {
  if (!window.mermaid || typeof mermaid.init !== 'function') return;
  const nodes = container.querySelectorAll('.mermaid:not([data-processed="true"])');
  if (!nodes.length) return;
  try {
    mermaid.init(undefined, nodes);
  } catch (err) {
    console.warn('Mermaid rendering error:', err);
  }
}

function renderBubbleContent(bubble, answer, reasoning, isFinal = false, detectedRepetition = false, agentSteps = []) {
  const thinkHtml = reasoning
    ? `<details class="thinking" ${!answer && !isFinal ? 'open' : ''}><summary>${!answer && !isFinal ? '🧠 思考中…' : '🧠 推理過程'}</summary><div class="thinking-body">${renderMarkdownToHtml(reasoning)}</div></details>`
    : '';

  let stepsHtml = '';
  if (agentSteps && agentSteps.length) {
    stepsHtml = `<div class="agent-steps-container">` + agentSteps.map(step => {
      if (step.type === 'tool_executing') {
        const isSkillCreate = step.name === 'create_skill';
        const badge = isSkillCreate ? '✨ 自建 Skill' : '🛠️ 工具調用';
        return `
          <div class="agent-step-card" id="step_${step.call_id}">
            <div class="agent-step-head">
              <span>${badge}: <code>${escapeHtml(step.name)}</code></span>
              <span class="agent-step-badge">執行中...</span>
            </div>
            <div class="agent-step-body">
              <pre><code>${escapeHtml(JSON.stringify(step.args, null, 2))}</code></pre>
            </div>
          </div>
        `;
      } else if (step.type === 'tool_result') {
        const isSkillCreate = step.name === 'create_skill';
        const badge = isSkillCreate ? '✨ Skill 已註冊' : '✅ 執行結果';
        return `
          <div class="agent-step-card done" id="res_${step.call_id}">
            <div class="agent-step-head">
              <span>${badge}: <code>${escapeHtml(step.name)}</code></span>
              <span class="agent-step-badge" style="background:#27ae60">完成</span>
            </div>
            <div class="agent-step-body">
              <pre><code>${escapeHtml(step.result)}</code></pre>
            </div>
          </div>
        `;
      }
      return '';
    }).join('') + `</div>`;
  }

  let bodyHtml = '';
  if (answer) {
    bodyHtml = renderMarkdownToHtml(answer);
  } else if (reasoning || (agentSteps && agentSteps.length)) {
    bodyHtml = isFinal ? '<p><em>（任務完成）</em></p>' : '';
  } else {
    bodyHtml = isFinal ? '<p><em>（沒有文字輸出）</em></p>' : '<p>生成中…</p>';
  }

  const degenHtml = detectedRepetition ? '<div class="degeneration">偵測到重複退化，已折疊畫面內容</div>' : '';
  bubble.innerHTML = `${degenHtml}${thinkHtml}${stepsHtml}${bodyHtml}`;

  if (isFinal) {
    applyMermaid(bubble);
  }
}

function collapseDegenerateRepetition(text = '') {
  const normalized = String(text), minChunk = 8, maxChunk = 160;
  for (let size = Math.min(maxChunk, Math.floor(normalized.length / 4)); size >= minChunk; size--) {
    for (let start = Math.max(0, normalized.length - size * 12); start <= normalized.length - size * 4; start++) {
      const chunk = normalized.slice(start, start + size);
      if (!chunk.trim() || /^\s+$/.test(chunk)) continue;
      let count = 1, pos = start + size;
      while (normalized.slice(pos, pos + size) === chunk) { count++; pos += size; }
      if (count >= 4) return { text: normalized.slice(0, start) + chunk.repeat(2) + `\n\n[已折疊 ${count - 2} 次重複內容]`, detected: true, count, chunk };
    }
  }
  return { text: normalized, detected: false };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function normalizeImage(file) {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxEdge = 2048;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({
        name: file.name || 'image.jpg',
        url: canvas.toDataURL('image/jpeg', 0.90),
        converted: true
      });
    };
    img.onerror = () => {
      resolve({
        name: file.name || 'image.png',
        url: dataUrl,
        converted: false
      });
    };
    img.src = dataUrl;
  });
}

function renderPreviews(side) {
  const box = $('.previews', lanes[side]);
  if (!box) return;
  box.innerHTML = state[side].images.map((im, i) => `<div class="preview"><img src="${im.url}" alt="${escapeHtml(im.name)}"><button data-remove="${i}" aria-label="移除圖片">×</button></div>`).join('');
  box.querySelectorAll('[data-remove]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const idx = +b.dataset.remove;
      state[side].images.splice(idx, 1);
      renderPreviews(side);
      if ($('#syncMode').checked) {
        const other = side === 'left' ? 'right' : 'left';
        state[other].images.splice(idx, 1);
        renderPreviews(other);
      }
    };
  });
}

async function addFiles(side, fileList) {
  try {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const added = await Promise.all(files.map(normalizeImage));
    if (!added.length) return;

    if ($('#syncMode').checked) {
      state.left.images.push(...added);
      state.right.images.push(...added);
      renderPreviews('left');
      renderPreviews('right');
      toast(`已加入 ${added.length} 張圖片（同步兩側）`);
    } else {
      state[side].images.push(...added);
      renderPreviews(side);
      toast(`已加入 ${added.length} 張圖片`);
    }
  } catch (error) {
    console.error('Image upload error:', error);
    toast('圖片載入失敗: ' + error.message);
  }
}

function addMessage(side, role, text, images = [], reasoning = '') {
  const box = $('.messages', lanes[side]);
  $('.empty', box)?.remove();
  const el = document.createElement('article');
  el.className = `message ${role}`;
  const imgs = images.length ? `<div class="message-images">${images.map(i => `<img src="${i.url}" alt="${escapeHtml(i.name || 'image')}">`).join('')}</div>` : '';
  el.innerHTML = `${imgs}<div class="bubble"></div><div class="meta">${role === 'user' ? 'YOU' : 'MODEL'} · ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</div>`;
  box.append(el);
  const bubble = el.querySelector('.bubble');
  renderBubbleContent(bubble, text, reasoning, true);
  box.scrollTop = box.scrollHeight;
  return el;
}

function makeContent(text, images) {
  if (!images || !images.length) return text;
  return [{ type: 'text', text: text || '請仔細描述並分析這張圖片。' }, ...images.map(i => ({ type: 'image_url', image_url: { url: i.url } }))];
}

async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data);
        } catch {}
      }
    }
  }

  if (buffer.trim().startsWith('data: ')) {
    const data = buffer.trim().slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        yield JSON.parse(data);
      } catch {}
    }
  }
}

async function send(side, override = null) {
  const lane = lanes[side], s = state[side];
  if (s.busy) {
    s.controller?.abort();
    return;
  }
  const def = modelDefs[s.modelKey];
  const input = $('textarea', lane);
  const text = override?.text !== undefined ? override.text : input.value.trim();
  const images = override?.images ? [...override.images] : [...s.images];
  if (!text && !images.length) return toast('請輸入問題或加入圖片');

  s.busy = true;
  const sendBtn = $('.send', lane);
  sendBtn.innerHTML = '<span>■</span>';
  sendBtn.title = '停止生成';
  input.value = '';
  input.style.height = 'auto';
  s.images = [];
  renderPreviews(side);
  addMessage(side, 'user', text || '分析這張圖片', images);
  const content = makeContent(text, images);
  s.history.push({ role: 'user', content });
  const pending = addMessage(side, 'assistant', '', [], '');
  const bubble = $('.bubble', pending);
  renderBubbleContent(bubble, '', '', false);
  const started = performance.now();
  let answer = '';
  let reasoning = '';
  let tokenCount = 0;
  let serverTokens = null;
  let serverTps = null;
  let finishReason = null;
  let animFrameId = null;
  const agentSteps = [];
  const isAgent = $('#agentMode')?.checked;

  try {
    s.controller = new AbortController();
    const body = {
      model: def.model,
      messages: s.history,
      max_tokens: Number($('#maxTokens').value),
      temperature: 0.2,
      stream: true,
      agent_mode: isAgent,
      chat_template_kwargs: { enable_thinking: !!s.thinking }
    };
    if (def.repetitionPenalty) body.repetition_penalty = def.repetitionPenalty;

    const res = await fetch(`/api/${def.key}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: s.controller.signal
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson?.error?.message || errJson?.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    const updateView = (isFinal = false) => {
      const cleaned = isFinal ? collapseDegenerateRepetition(answer) : { text: answer, detected: false };
      renderBubbleContent(bubble, cleaned.text, reasoning, isFinal, cleaned.detected, agentSteps);
      $('.messages', lane).scrollTop = $('.messages', lane).scrollHeight;

      const elapsed = (performance.now() - started) / 1000;
      const currentTokens = serverTokens ?? tokenCount;
      const liveTps = elapsed > 0 && currentTokens > 0 ? (currentTokens / elapsed).toFixed(1) : null;
      const tpsStr = serverTps ? `${serverTps.toFixed(1)} tok/s` : (liveTps ? `${liveTps} tok/s` : '');
      const metric = `${tpsStr ? `${tpsStr} · ` : ''}${elapsed.toFixed(1)}s${!isFinal ? ' (串流中)' : ''}`;
      $('.last-metric', lane).textContent = metric;
    };

    let renderScheduled = false;

    for await (const chunk of readSSE(res)) {
      if (chunk.agent_step) {
        agentSteps.push(chunk.agent_step);
        if (chunk.agent_step.skills_count !== undefined) {
          updateSkillsBadge(chunk.agent_step.skills_count);
        }
      }

      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta || {};
        if (delta.reasoning || delta.reasoning_content) {
          reasoning += (delta.reasoning || delta.reasoning_content);
          tokenCount++;
        }
        if (delta.content) {
          answer += delta.content;
          tokenCount++;
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
      if (chunk.usage?.completion_tokens) {
        serverTokens = chunk.usage.completion_tokens;
      }
      if (chunk.timings?.predicted_per_second) {
        serverTps = chunk.timings.predicted_per_second;
      }

      if (!renderScheduled) {
        renderScheduled = true;
        animFrameId = requestAnimationFrame(() => {
          renderScheduled = false;
          updateView(false);
        });
      }
    }

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    updateView(true);

    const cleaned = collapseDegenerateRepetition(answer);
    s.history.push({ role: 'assistant', content: answer || reasoning });
    const elapsed = (performance.now() - started) / 1000;
    const finalTokens = serverTokens ?? (tokenCount || null);
    const finalTps = serverTps ?? (elapsed > 0 && finalTokens ? (finalTokens / elapsed) : null);
    const suffix = cleaned.detected ? ' · REPETITION' : finishReason === 'length' ? ' · LIMIT' : '';
    const metric = (finalTps ? `${finalTps.toFixed(1)} tok/s · ${elapsed.toFixed(1)}s` : `${finalTokens ?? '—'} tokens · ${elapsed.toFixed(1)}s`) + suffix;
    $('.last-metric', lane).textContent = metric;
    $('.meta', pending).textContent = `MODEL · ${metric}`;
    fetchSkills(); // refresh skill drawer
  } catch (e) {
    bubble.textContent = e.name === 'AbortError' ? '已停止生成' : `錯誤：${e.message}`;
    pending.classList.add('error');
  } finally {
    s.busy = false;
    s.controller = null;
    sendBtn.innerHTML = '<span>↗</span>';
    sendBtn.title = '送出';
  }
}

function setLaneModel(side, modelKey) {
  const def = modelDefs[modelKey];
  if (!def) return;
  state[side].modelKey = modelKey;
  state[side].thinking = def.defaultThinking;
  const lane = lanes[side];
  const thinkCb = $('.think-cb', lane);
  if (thinkCb) thinkCb.checked = def.defaultThinking;
  lane.className = `lane ${def.className}`;
  lane.dataset.model = modelKey;
  $('.model-title', lane).textContent = def.name;
  $('.model-desc', lane).textContent = def.desc;
  $('.t-context', lane).innerHTML = def.context;
  $('.t-draft', lane).innerHTML = def.draft;
  $('textarea', lane).placeholder = def.placeholder;
  const empty = $('.empty', lane);
  if (empty) {
    $('.empty-icon', empty).textContent = def.icon;
    $('.empty-text', empty).innerHTML = def.emptyCopy;
  }
}

function clearSide(side) {
  const def = modelDefs[state[side].modelKey];
  state[side].history = [];
  state[side].images = [];
  state[side].controller?.abort();
  $('.messages', lanes[side]).innerHTML = `<div class="empty"><span class="empty-icon">${def.icon}</span><p class="empty-text">${def.emptyCopy}</p></div>`;
  renderPreviews(side);
  $('.last-metric', lanes[side]).textContent = '尚未測試';
}

function updateSkillsBadge(count) {
  const badge = $('#skillBadge');
  if (badge) badge.textContent = count;
}

let currentSkillFilter = 'all';

async function fetchSkills() {
  try {
    const res = await fetch('/api/skills');
    const data = await res.json();
    updateSkillsBadge(data.custom_skills?.length || 0);
    const content = $('#drawerContent');
    if (!content) return;

    const qwenCount = data.by_model?.qwen?.length || 0;
    const qwen38Count = data.by_model?.qwen38?.length || 0;
    const museCount = data.by_model?.muse?.length || 0;

    let html = `
      <div class="skill-tabs">
        <button class="tab-btn ${currentSkillFilter === 'all' ? 'active' : ''}" data-tab="all">全部 (${data.custom_skills?.length || 0})</button>
        <button class="tab-btn ${currentSkillFilter === 'qwen' ? 'active' : ''}" data-tab="qwen">Qwen 3.6 (${qwenCount})</button>
        <button class="tab-btn ${currentSkillFilter === 'qwen38' ? 'active' : ''}" data-tab="qwen38">Qwen 3.8 (${qwen38Count})</button>
      </div>
    `;

    html += `<h4 style="margin-top:10px;">📦 內建基礎工具 (${data.built_in?.length || 0})</h4>`;
    html += (data.built_in || []).map(b => `
      <div class="skill-card">
        <h4>🛠️ ${escapeHtml(b.name)}</h4>
        <p>${escapeHtml(b.description)}</p>
      </div>
    `).join('');

    let displayedSkills = data.custom_skills || [];
    if (currentSkillFilter !== 'all') {
      displayedSkills = (data.by_model?.[currentSkillFilter]) || [];
    }

    html += `<h4 style="margin-top:20px;">✨ 隔離動態 Skills (${displayedSkills.length})</h4>`;
    if (!displayedSkills.length) {
      html += `<p style="color:var(--muted);font-size:12px;">此分類下尚無模型建立的專屬 Skill。<br>下達指令後各模型將獨立建立自己的工具！</p>`;
    } else {
      html += displayedSkills.map(s => {
        const modelName = s.model === 'qwen' ? 'Qwen 3.6' : s.model === 'qwen38' ? 'Qwen 3.8' : s.model;
        const tagClass = s.model || 'qwen';
        return `
          <div class="skill-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <h4 style="margin:0;">🌟 ${escapeHtml(s.name)}</h4>
              <span class="skill-model-tag tag-${tagClass}">🏷️ ${modelName} 專屬</span>
            </div>
            <p>${escapeHtml(s.description)}</p>
            <pre><code>${escapeHtml(s.code)}</code></pre>
          </div>
        `;
      }).join('');
    }
    content.innerHTML = html;

    content.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        currentSkillFilter = btn.dataset.tab;
        fetchSkills();
      };
    });
  } catch {}
}

window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length) {
    const laneEl = e.target.closest?.('.lane');
    const side = laneEl?.dataset?.side || 'left';
    addFiles(side, files);
  }
});

Object.entries(lanes).forEach(([side, lane]) => {
  const input = $('textarea', lane), file = $('input[type=file]', lane);
  const select = $('.model-select', lane);
  const thinkCb = $('.think-cb', lane);

  if (select) {
    select.onchange = () => {
      setLaneModel(side, select.value);
      clearSide(side);
    };
  }
  if (thinkCb) {
    thinkCb.onchange = () => {
      state[side].thinking = thinkCb.checked;
      toast(`${modelDefs[state[side].modelKey].name}：${thinkCb.checked ? '已開啟思考模式 🧠' : '已關閉思考模式（直出）'}`);
    };
  }
  file.onchange = () => { addFiles(side, file.files); file.value = ''; };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; };
  input.onpaste = e => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(side, files);
      return;
    }
    if (e.clipboardData?.files?.length) {
      e.preventDefault();
      addFiles(side, e.clipboardData.files);
    }
  };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); triggerSend(side); } };
  $('.send', lane).onclick = () => {
    if (state[side].busy) {
      state[side].controller?.abort();
    } else {
      triggerSend(side);
    }
  };
  $('.clear-one', lane).onclick = () => clearSide(side);

  lane.addEventListener('dragenter', e => { e.preventDefault(); lane.classList.add('drag-over'); });
  lane.addEventListener('dragover', e => { e.preventDefault(); lane.classList.add('drag-over'); });
  lane.addEventListener('dragleave', e => {
    if (!lane.contains(e.relatedTarget)) lane.classList.remove('drag-over');
  });
  lane.addEventListener('drop', e => {
    e.preventDefault();
    lane.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) {
      addFiles(side, e.dataTransfer.files);
    }
  });
});

function triggerSend(source) {
  const lane = lanes[source];
  const text = $('textarea', lane).value.trim();
  const images = [...state[source].images];
  if ($('#syncMode').checked) {
    send('left', { text, images });
    send('right', { text, images });
  } else {
    send(source);
  }
}

// Quick Chip click handler
document.querySelectorAll('.quick-chip').forEach(btn => {
  btn.onclick = () => {
    const p = btn.dataset.prompt;
    $('textarea', lanes.left).value = p;
    $('textarea', lanes.right).value = p;
    triggerSend('left');
  };
});

// Skill Drawer Controls
$('#openSkillsBtn').onclick = () => {
  fetchSkills();
  $('#skillDrawer').classList.add('open');
};
$('#closeDrawerBtn').onclick = () => {
  $('#skillDrawer').classList.remove('open');
};
$('#clearSkillsBtn').onclick = async () => {
  if (confirm('確定要清空所有模型自建的 Skill 嗎？')) {
    await fetch('/api/skills', { method: 'DELETE' });
    toast('已清空動態 Skills');
    fetchSkills();
  }
};

$('#clearAll').onclick = () => Object.keys(lanes).forEach(clearSide);

async function health() {
  try {
    const h = await (await fetch('/api/health')).json();
    $('#qwenHealth')?.classList.toggle('ok', !!h.qwen);
    $('#qwen38Health')?.classList.toggle('ok', !!h.qwen38);
    $('#museHealth')?.classList.toggle('ok', !!h.muse);
  } catch {}
}
health();
fetchSkills();
setInterval(health, 15000);
