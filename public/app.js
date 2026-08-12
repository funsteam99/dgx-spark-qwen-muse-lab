const configs = {
  qwen: { model: "nvidia/Qwen3.6-35B-A3B-NVFP4", thinkingOff: true },
  muse: { model: "muse-glimmer-30B" }
};
const state = Object.fromEntries(Object.keys(configs).map(side => [side, { history: [], images: [], busy: false, controller: null }]));
const $ = (sel, root=document) => root.querySelector(sel);
const lanes = Object.fromEntries([...document.querySelectorAll('.lane')].map(el => [el.dataset.side, el]));

function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.add('show'); clearTimeout(el.t); el.t=setTimeout(()=>el.classList.remove('show'),2600); }
function escapeHtml(s=''){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderText(text=''){ return escapeHtml(text).replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>').replace(/\n/g,'<br>'); }

async function filesToImages(files){
  const valid=[...files].filter(f=>f.type.startsWith('image/'));
  return Promise.all(valid.map(file=>new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve({name:file.name,url:r.result}); r.onerror=reject; r.readAsDataURL(file); })));
}
function renderPreviews(side){
  const box=$('.previews',lanes[side]); box.innerHTML=state[side].images.map((im,i)=>`<div class="preview"><img src="${im.url}" alt="${escapeHtml(im.name)}"><button data-remove="${i}" aria-label="移除圖片">×</button></div>`).join('');
  box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state[side].images.splice(+b.dataset.remove,1);renderPreviews(side)});
}
async function addFiles(side, files){ const added=await filesToImages(files); state[side].images.push(...added); renderPreviews(side); }

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
    const body={model:configs[side].model,messages:s.history,max_tokens:1024,temperature:0.7,stream:false};
    if(configs[side].thinkingOff) body.chat_template_kwargs={enable_thinking:false};
    const res=await fetch(`/api/${side}/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:s.controller.signal});
    const data=await res.json(); if(!res.ok) throw new Error(data?.error?.message||data?.error||`HTTP ${res.status}`);
    const msg=data.choices?.[0]?.message||{}; const answer=msg.content||''; const reasoning=msg.reasoning||msg.reasoning_content||'';
    bubble.innerHTML=(reasoning?`<details class="thinking"><summary>推理過程</summary>${renderText(reasoning)}</details>`:'')+renderText(answer||'（沒有文字輸出）');
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
