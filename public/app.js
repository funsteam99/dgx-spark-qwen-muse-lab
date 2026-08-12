const configs = {
  qwen: { model: "nvidia/Qwen3.6-35B-A3B-NVFP4", thinkingOff: true },
  muse: { model: "muse-glimmer-30B" }
};
const state = Object.fromEntries(Object.keys(configs).map(side => [side, { history: [], images: [], busy: false, controller: null }]));
const $ = (sel, root=document) => root.querySelector(sel);
const lanes = Object.fromEntries([...document.querySelectorAll('.lane')].map(el => [el.dataset.side, el]));

function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.add('show'); clearTimeout(el.t); el.t=setTimeout(()=>el.classList.remove('show'),2600); }
function escapeHtml(s=''){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderInline(text=''){
  const tokens=[];
  const hold=html=>{tokens.push(html);return `\u0000${tokens.length-1}\u0000`};
  let out=text.replace(/`([^`]+)`/g,(_,code)=>hold(`<code>${escapeHtml(code)}</code>`));
  out=out.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,(_,label,url)=>{
    if(!/^(https?:\/\/|mailto:)/i.test(url))return `${label} (${url})`;
    return hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
  });
  out=escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/__([^_]+)__/g,'<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g,'<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g,'$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[+i]);
}
function renderText(text=''){
  const lines=String(text).replace(/\r/g,'').split('\n'), html=[];
  let code=false, codeLang='', codeLines=[], list='';
  const closeList=()=>{if(list){html.push(`</${list}>`);list=''}};
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const fence=line.match(/^```\s*([\w+-]*)/);
    if(fence){
      if(code){html.push(`<pre><code${codeLang?` data-language="${escapeHtml(codeLang)}"`:''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);code=false;codeLines=[];codeLang='';}
      else{closeList();code=true;codeLang=fence[1]||'';}
      continue;
    }
    if(code){codeLines.push(line);continue;}
    if(/^\s*$/.test(line)){closeList();continue;}
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      closeList(); const split=row=>row.replace(/^\s*\||\|\s*$/g,'').split('|').map(c=>c.trim());
      const heads=split(line); i++; const rows=[];
      while(i+1<lines.length&&lines[i+1].includes('|')&&!/^\s*$/.test(lines[i+1]))rows.push(split(lines[++i]));
      html.push(`<div class="table-scroll"><table><thead><tr>${heads.map(c=>`<th>${renderInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue;
    }
    const heading=line.match(/^(#{1,4})\s+(.+)/); if(heading){closeList();const level=heading[1].length;html.push(`<h${level+1}>${renderInline(heading[2])}</h${level+1}>`);continue;}
    if(/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)){closeList();html.push('<hr>');continue;}
    const quote=line.match(/^>\s?(.*)/);if(quote){closeList();html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);continue;}
    const ul=line.match(/^\s*[-+*]\s+(.+)/), ol=line.match(/^\s*\d+[.)]\s+(.+)/), nextList=ul?'ul':ol?'ol':'';
    if(nextList){if(list!==nextList){closeList();list=nextList;html.push(`<${list}>`)}html.push(`<li>${renderInline((ul||ol)[1])}</li>`);continue;}
    closeList(); html.push(`<p>${renderInline(line)}</p>`);
  }
  if(code)html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  closeList(); return html.join('');
}

function readDataUrl(file){
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
}
async function normalizeImage(file){
  if(['image/jpeg','image/png'].includes(file.type)) return {name:file.name,url:await readDataUrl(file)};
  let bitmap;
  try{ bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}); }
  catch{ throw new Error(`${file.name} 無法解碼，請改用 JPEG、PNG 或 WebP`); }
  const maxEdge=2048, scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#f7f4ec'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close?.();
  return {name:file.name,url:canvas.toDataURL('image/jpeg',0.92),converted:true};
}
async function filesToImages(files){
  const valid=[...files].filter(f=>f.type.startsWith('image/'));
  return Promise.all(valid.map(normalizeImage));
}
function renderPreviews(side){
  const box=$('.previews',lanes[side]); box.innerHTML=state[side].images.map((im,i)=>`<div class="preview"><img src="${im.url}" alt="${escapeHtml(im.name)}"><button data-remove="${i}" aria-label="移除圖片">×</button></div>`).join('');
  box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state[side].images.splice(+b.dataset.remove,1);renderPreviews(side)});
}
async function addFiles(side, files){
  try{ const added=await filesToImages(files); state[side].images.push(...added); renderPreviews(side); if(added.some(i=>i.converted))toast('已自動轉成模型相容的 JPEG'); }
  catch(error){ toast(error.message); }
}

function addMessage(side, role, text, images=[], reasoning=''){
  const box=$('.messages',lanes[side]); $('.empty',box)?.remove();
  const el=document.createElement('article'); el.className=`message ${role}`;
  const imgs=images.length?`<div class="message-images">${images.map(i=>`<img src="${i.url}" alt="${escapeHtml(i.name)}">`).join('')}</div>`:'';
  const think=reasoning?`<details class="thinking"><summary>推理過程</summary>${renderText(reasoning)}</details>`:'';
  el.innerHTML=`${imgs}<div class="bubble">${think}${renderText(text)}</div><div class="meta">${role==='user'?'YOU':'MODEL'} · ${new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</div>`;
  box.append(el); box.scrollTop=box.scrollHeight; return el;
}
function makeContent(text, images){
  if(!images.length) return text;
  return [{type:'text',text:text||'請仔細描述並分析這張圖片。'},...images.map(i=>({type:'image_url',image_url:{url:i.url}}))];
}
async function send(side, override=null){
  const lane=lanes[side], s=state[side]; if(s.busy)return;
  const input=$('textarea',lane); const text=override?.text ?? input.value.trim(); const images=override?.images ?? [...s.images];
  if(!text&&!images.length)return toast('請輸入問題或加入圖片');
  s.busy=true; $('.send',lane).disabled=true; input.value=''; input.style.height='auto'; s.images=[];renderPreviews(side);
  addMessage(side,'user',text||'分析這張圖片',images);
  const content=makeContent(text,images); s.history.push({role:'user',content});
  const pending=addMessage(side,'assistant','思考中…'); const bubble=$('.bubble',pending); const started=performance.now();
  try{
    s.controller=new AbortController();
    const body={model:configs[side].model,messages:s.history,max_tokens:Number($('#maxTokens').value),temperature:0.7,stream:false};
    if(configs[side].thinkingOff) body.chat_template_kwargs={enable_thinking:false};
    const res=await fetch(`/api/${side}/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:s.controller.signal});
    const data=await res.json(); if(!res.ok) throw new Error(data?.error?.message||data?.error||`HTTP ${res.status}`);
    const msg=data.choices?.[0]?.message||{}; const answer=msg.content||''; const reasoning=msg.reasoning||msg.reasoning_content||'';
    bubble.innerHTML=(reasoning?`<details class="thinking"><summary>推理過程</summary>${renderText(reasoning)}</details>`:'')+renderText(answer||'（沒有文字輸出）');
    $('.messages',lane).scrollTop=$('.messages',lane).scrollHeight;
    s.history.push({role:'assistant',content:answer});
    const elapsed=(performance.now()-started)/1000, tokens=data.usage?.completion_tokens, serverTps=data.timings?.predicted_per_second;
    const metric=serverTps?`${serverTps.toFixed(1)} tok/s · ${elapsed.toFixed(1)}s`:`${tokens??'—'} tokens · ${elapsed.toFixed(1)}s`;
    $('.last-metric',lane).textContent=metric; $('.meta',pending).textContent=`MODEL · ${metric}`;
  }catch(e){ bubble.textContent=e.name==='AbortError'?'已停止生成':`錯誤：${e.message}`; pending.classList.add('error'); }
  finally{s.busy=false;s.controller=null;$('.send',lane).disabled=false;}
}

function clearSide(side){ state[side].history=[];state[side].images=[];state[side].controller?.abort(); const letter=side==='qwen'?'Q':'M'; const copy=side==='qwen'?'丟入一張圖，問它看見什麼。<br>或開啟同步，讓兩邊回答同一題。':'同一張圖、同一個問題。<br>直接比較細節、推理與速度。'; $('.messages',lanes[side]).innerHTML=`<div class="empty"><span>${letter}</span><p>${copy}</p></div>`; renderPreviews(side);$('.last-metric',lanes[side]).textContent='尚未測試'; }
Object.entries(lanes).forEach(([side,lane])=>{
  const input=$('textarea',lane), file=$('input[type=file]',lane);
  file.onchange=()=>{addFiles(side,file.files);file.value=''};
  input.oninput=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,130)+'px'};
  input.onpaste=e=>{if(e.clipboardData.files.length)addFiles(side,e.clipboardData.files)};
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); triggerSend(side)}};
  $('.send',lane).onclick=()=>triggerSend(side); $('.clear-one',lane).onclick=()=>clearSide(side);
  lane.ondragover=e=>e.preventDefault(); lane.ondrop=e=>{e.preventDefault();addFiles(side,e.dataTransfer.files)};
});
function triggerSend(source){
  const lane=lanes[source], text=$('textarea',lane).value.trim(), images=[...state[source].images];
  if($('#syncMode').checked){ for(const side of Object.keys(lanes)) send(side,{text,images}); } else send(source);
}
$('#clearAll').onclick=()=>Object.keys(lanes).forEach(clearSide);
async function health(){try{const h=await(await fetch('/api/health')).json();$('#qwenHealth').classList.toggle('ok',h.qwen);$('#museHealth').classList.toggle('ok',h.muse)}catch{}} health();setInterval(health,15000);
