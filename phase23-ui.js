/* Phase 2+3 final UI/UX layer. Keeps legacy data, router, exam, and question logic intact. */
(function(){
  'use strict';

  const style=document.createElement('style');
  style.id='phase23-style';
  style.textContent=`
    :root{--glass:rgba(255,255,255,.78);--glass-strong:rgba(255,255,255,.92);--glass-border:rgba(15,107,79,.12);--glass-shadow:0 14px 34px rgba(23,58,43,.075)}
    .phase23-page{max-width:600px;margin:0 auto}
    .phase23-head{padding:4px 2px 20px}.phase23-back{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:var(--emerald-d);font:700 13px inherit;padding:5px 0;cursor:pointer}.phase23-title{font-size:27px;line-height:1.2;letter-spacing:-.035em;margin:12px 0 7px;color:var(--text)}.phase23-subtitle{font-size:14px;line-height:1.65;color:var(--sub);margin:0;max-width:540px}
    .dictionary-v2 .tool-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.dictionary-v2 .tool-stat{background:var(--glass);border:1px solid var(--glass-border);border-radius:19px;padding:16px;box-shadow:var(--glass-shadow)}.dictionary-v2 .tool-stat strong{display:block;font-size:16px}.dictionary-v2 .tool-stat span{display:block;color:var(--sub);font-size:12px;margin-top:3px}.dictionary-v2 .dict-search-card{display:flex;gap:8px;align-items:center;background:var(--glass);border:1px solid var(--glass-border);border-radius:20px;padding:9px;box-shadow:var(--glass-shadow)}.dictionary-v2 .dict-search-card input{border:0;background:transparent;min-width:0;padding:12px;font-size:16px}.dictionary-v2 .dict-search-card input:focus{outline:0}.dictionary-v2 .dict-search-card .btn{width:auto;white-space:nowrap;padding:12px 18px}.dictionary-v2 .dict-result{background:var(--glass-strong);border:1px solid var(--glass-border);border-radius:22px;padding:18px;box-shadow:var(--glass-shadow);margin-top:16px}.dictionary-v2 .dict-result h2{font-size:25px;margin:8px 0 2px}.dictionary-v2 .dict-result p{line-height:1.65}.dictionary-v2 .dict-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:14px}.dictionary-v2 .dict-result-grid>div{background:rgba(232,244,238,.62);border-radius:13px;padding:11px}.dictionary-v2 .dict-result-grid b{font-size:11px;color:var(--sub)}.dictionary-v2 .dict-result-grid p{font-size:13px;margin:4px 0 0}.dictionary-v2 .dict-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.dictionary-v2 .dict-actions .btn{flex:1;min-width:145px}
    .exam-center .card,.exam-setup .card,.question-bank-page .card,.explorer-card{box-shadow:var(--glass-shadow);border-color:var(--glass-border)}
    .phase-nav{display:none!important}.page>.phase-nav{display:none!important}
@media(max-width:430px){.phase23-title{font-size:24px}.dictionary-v2 .dict-result-grid{grid-template-columns:1fr}.dictionary-v2 .dict-search-card .btn{padding:12px 14px}}
  `;
  document.head.appendChild(style);

  const esc23=s=>{const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const DictState={q:'',loading:false,result:null,error:''};
  async function lookupDictionaryWord(word){
    const q=word.trim();if(!q)return null;
    const cacheKey='dictionary-api-v2:'+q.toLowerCase();
    try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(cached&&Date.now()-cached.at<604800000)return cached.value}catch(_){ }
    const isBn=/[\u0980-\u09FF]/.test(q);
    const fetchFast=async(url)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);try{const r=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}};
    let value=null;
    if(!isBn){
      const data=await fetchFast('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(q.toLowerCase())).catch(()=>null);
      const entry=data?.[0];
      if(entry){const meanings=entry.meanings||[],defs=meanings.flatMap(m=>(m.definitions||[]).map(d=>({pos:m.partOfSpeech||'word',definition:d.definition,example:d.example||'',synonyms:[...(d.synonyms||[]),...(m.synonyms||[])]})));value={word:entry.word||q,phonetic:entry.phonetic||entry.phonetics?.find(x=>x.text)?.text||'-',pos:meanings.map(m=>m.partOfSpeech).filter(Boolean).join(', ')||'Word',definition:defs[0]?.definition||'',definitions:defs.slice(0,4),synonyms:[...new Set(defs.flatMap(x=>x.synonyms))].slice(0,10),source:'Free Dictionary API',sourceUrl:'https://api.dictionaryapi.dev/'};}
    }
    if(!value){
      const lang=isBn?'bn':'en',url='https://'+lang+'.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(q.replace(/\s+/g,'_')),data=await fetchFast(url).catch(()=>null);
      if(data?.extract)value={word:q,phonetic:'-',pos:isBn?'বাংলা শব্দ':'Word',definition:data.extract,definitions:[{pos:'Reference',definition:data.extract,example:'',synonyms:[]}],synonyms:[],source:(isBn?'বাংলা':'English')+' Wikipedia',sourceUrl:data.content_urls?.desktop?.page||url};
    }
    if(!value&&typeof dictLookup==='function'){const local=dictLookup(q);if(local)value={word:local.word||q,phonetic:local.pron||'-',pos:local.pos||'Word',definition:local.bn||local.en||'',definitions:[{pos:local.pos||'Word',definition:local.bn||local.en||'',example:local.ex||'',synonyms:[]}],synonyms:(local.syn||'').split(',').map(x=>x.trim()).filter(Boolean),source:'Local fallback',sourceUrl:''}}
    try{localStorage.setItem(cacheKey,JSON.stringify({at:Date.now(),value}))}catch(_){ }
    return value;
  }
  function renderDictionaryV2(){
    const q=DictState.q||Router.params?.q||'';DictState.q=q;
    let phaseData={};try{phaseData=JSON.parse(localStorage.getItem('admission_phase345_v1')||'{}')}catch(_){phaseData={}} const saved=phaseData.savedWords||[]; const vocab=phaseData.vocab||[];
    const r=DictState.result, result=DictState.loading?`<div class="card empty">শব্দের definition, phonetic ও example খোঁজা হচ্ছে…</div>`:DictState.error?`<div class="card empty">${esc23(DictState.error)}</div>`:r?`<article class="dict-result"><span class="pill">${esc23(r.pos||'Word')}</span><h2>${esc23(r.word)}</h2><div class="muted">/${esc23(r.phonetic||'-')}/ · ${esc23(r.source||'Dictionary API')}</div><div class="dict-result-grid"><div><b>বাংলা-friendly definition / অর্থ</b><p>${esc23(r.definition||'-')}</p></div><div><b>Part of speech</b><p>${esc23(r.pos||'-')}</p></div><div><b>Synonyms / সমার্থক</b><p>${esc23(r.synonyms?.join(', ')||'-')}</p></div><div><b>Examples / উদাহরণ</b><p>${esc23(r.definitions?.find(x=>x.example)?.example||'Example পাওয়া যায়নি।')}</p></div>${(r.definitions||[]).slice(0,2).map((d,i)=>`<div><b>Definition ${i+1}</b><p>${esc23(d.definition)}</p></div>`).join('')}</div><div class="dict-actions"><button class="btn secondary" onclick="addPhaseWord('savedWords','${esc23(r.word)}')">⭐ Save word</button><button class="btn ghost" onclick="addPhaseWord('vocab','${esc23(r.word)}')">📚 Add vocabulary</button>${r.sourceUrl?`<a class="btn ghost" target="_blank" rel="noopener noreferrer" href="${esc23(r.sourceUrl)}">Source ↗</a>`:''}</div></article>`:(q?`<div class="card empty">“${esc23(q)}” শব্দটির জন্য Free Dictionary ও বাংলা fallback-এ ফল পাওয়া যায়নি। বানান যাচাই করে আবার Search করুন।</div>`:'');
    const html=`<div class="phase23-page dictionary-v2"><div class="phase23-head"><button class="phase23-back" onclick="navigate('dashboard')">← <span>Dictionary</span></button><h1 class="phase23-title">Ultimate Dictionary</h1><p class="phase23-subtitle">Free Dictionary API থেকে definition, phonetic, part of speech, example ও synonyms পান। বাংলা শব্দের জন্য Wikipedia fallback আছে।</p></div><form class="dict-search-card" onsubmit="searchDict(event)"><input id="dictQ" value="${esc23(q)}" placeholder="যেমন: resilient / অমর" required><button class="btn" type="submit" ${DictState.loading?'disabled':''}>${DictState.loading?'Searching…':'Search'}</button></form><div class="tool-stat-grid"><div class="tool-stat"><strong>⭐ Saved</strong><span>${saved.length} words</span></div><div class="tool-stat"><strong>📚 Vocabulary</strong><span>${vocab.length} words</span></div></div>${result}</div>`;renderShell(html,{topbar:false});
  }
  window.renderDictionaryV2=renderDictionaryV2;window.renderDictionary=renderDictionaryV2;
  window.searchDict=async e=>{e.preventDefault();const q=document.getElementById('dictQ')?.value.trim()||'';if(!q||DictState.loading)return;Router.params={q};DictState.q=q;DictState.loading=true;DictState.error='';DictState.result=null;renderDictionaryV2();try{DictState.result=await lookupDictionaryWord(q);if(!DictState.result)DictState.error='এই শব্দটি Free Dictionary API বা বাংলা fallback-এ পাওয়া যায়নি। বানান যাচাই করে আবার Search করুন।'}catch(_){DictState.error='Dictionary API এখন সাময়িকভাবে unavailable। কিছুক্ষণ পর আবার চেষ্টা করুন।'}finally{DictState.loading=false;renderDictionaryV2()}};

  // Keep special tools isolated to their own routes and remove any legacy secondary toolbar if a patch adds one.
  const oldRender=window.render;
  window.render=function phase23RouteAudit(){
    if(Router.path==='dictionary') return renderDictionaryV2();
    if(['daily-gk','memorizing','navigator'].some(x=>Router.path===x||Router.path.startsWith(x+'/'))) document.querySelectorAll('.phase-nav').forEach(n=>n.remove());
    return oldRender();
  };
  const oldShell=window.renderShell;
  window.renderShell=function phase23Shell(inner,opts){oldShell(inner,opts);document.querySelectorAll('.phase-nav').forEach(n=>n.remove())};
  const oldNavigate=window.navigate;
  window.navigate=function phase23Navigate(path){
    if(path==='web-chat'||path==='dictionary'){
      return oldNavigate(path);
    }
    return oldNavigate(path);
  };
})();

(function(){
  let commandPage=0;
  function updateCommandPage(index){
    const currentPath=String(window.Router?.path||location.hash.replace(/^#\/?/,'').split('?')[0]||'dashboard');
    if(currentPath!=='dashboard'&&currentPath!=='home'&&currentPath!=='')return;
    const track=document.getElementById('commandTrack');if(!track||!track.isConnected)return;
    const slideCount=Math.max(1,track.querySelectorAll('.command-slide').length);
    commandPage=Math.max(0,Math.min(slideCount-1,Number(index)||0));requestAnimationFrame(()=>{
      const activePath=String(window.Router?.path||location.hash.replace(/^#\/?/,'').split('?')[0]||'dashboard');
      if(activePath!=='dashboard'&&activePath!=='home'&&activePath!=='')return;
      if(!track.isConnected)return;
      // Translate by one slide; percentage is relative to the full track width.
      track.style.transform=`translate3d(${-commandPage*(100/slideCount)}%,0,0)`;
      document.querySelectorAll('.command-dot').forEach((dot,i)=>{dot.classList.toggle('active',i===commandPage);dot.setAttribute('aria-selected',i===commandPage?'true':'false')});
    });
  }
  window.goCommandPage=function(index){updateCommandPage(index)};
  function installCommandCarousel(){
    const currentPath=String(window.Router?.path||location.hash.replace(/^#\/?/,'').split('?')[0]||'dashboard');
    if(currentPath!=='dashboard'&&currentPath!=='home'&&currentPath!=='')return;
    const carousel=document.querySelector('.command-carousel'),track=document.getElementById('commandTrack');
    if(!carousel||!track||track.dataset.bound==='1')return;
    track.dataset.bound='1';let startX=0,startY=0,dragging=false,ignorePointerUntil=0;
    const beginSwipe=(x,y)=>{startX=x;startY=y;dragging=true};
    const finishSwipe=(x,y)=>{if(!dragging)return;dragging=false;const dx=x-startX,dy=y-startY;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)){requestAnimationFrame(()=>updateCommandPage(commandPage+(dx<0?1:-1)))}};
    carousel.addEventListener('pointerdown',e=>{if(Date.now()<ignorePointerUntil||(e.pointerType==='mouse'&&e.button!==0))return;beginSwipe(e.clientX,e.clientY);try{if(e.pointerId!=null&&carousel.setPointerCapture)carousel.setPointerCapture(e.pointerId)}catch(_){ }},{passive:true});
    carousel.addEventListener('pointerup',e=>{if(Date.now()<ignorePointerUntil)return;finishSwipe(e.clientX,e.clientY)},{passive:true});
    carousel.addEventListener('pointercancel',()=>{dragging=false});
    carousel.addEventListener('lostpointercapture',()=>{dragging=false});
    carousel.addEventListener('touchstart',e=>{const touch=e.changedTouches[0];if(!touch)return;ignorePointerUntil=Date.now()+650;beginSwipe(touch.clientX,touch.clientY)},{passive:true});
    carousel.addEventListener('touchend',e=>{const touch=e.changedTouches[0];if(!touch)return;ignorePointerUntil=Date.now()+650;finishSwipe(touch.clientX,touch.clientY)},{passive:true});
    carousel.addEventListener('touchcancel',()=>{ignorePointerUntil=Date.now()+650;dragging=false},{passive:true});
    updateCommandPage(commandPage);
  }
  const app=document.getElementById('app');
  if(app){let installFrame=0;const scheduleInstall=()=>{if(installFrame)return;installFrame=requestAnimationFrame(()=>{installFrame=0;installCommandCarousel()})};new MutationObserver(scheduleInstall).observe(app,{childList:true,subtree:true});setTimeout(installCommandCarousel,0)}
})();

(function(){
  const app=document.getElementById('app');
  if(!app)return;
  let auditFrame=0;
  let lastAuditKey='';
  const audit=()=>{
    auditFrame=0;
    if(!(Router.path==='question-bank'&&ExplorerState.subjectId&&!ExplorerState.topicId&&window.renderQuestionBankV2))return;
    const key=[Router.path,ExplorerState.subjectId,ExplorerState.topicId,Boolean(document.querySelector('.q-selected'))].join('|');
    if(key===lastAuditKey)return;
    lastAuditKey=key;
    // Render at most once per route/content state. The render itself mutates
    // #app, so a MutationObserver without this key guard becomes an infinite
    // render loop and makes the whole PWA look like it is shaking.
    window.renderQuestionBankV2();
  };
  const scheduleAudit=()=>{
    if(auditFrame)return;
    auditFrame=requestAnimationFrame(audit);
  };
  window.addEventListener('hashchange',()=>{lastAuditKey='';scheduleAudit()},{passive:true});
  new MutationObserver(scheduleAudit).observe(app,{childList:true,subtree:true});
})();
