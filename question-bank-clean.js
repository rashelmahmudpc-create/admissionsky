/* Question Bank, clean UI (owner design: question-bank-clean.html).
   Sole authority for #question-bank and #question-bank/* routes.
   Data: CACHE.subjects / CACHE.topics / CACHE.questions (cloud content sync).
   Progress: CACHE.settings.qbankState + mistakes + dailyStats (student sync). */
(function(){
'use strict';
if(window.__qbcInstalled)return;window.__qbcInstalled=true;
const P={back:'<path d="M15 18l-6-6 6-6"/>',chev:'<path d="M9 6l6 6-6 6"/>',search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',star:'<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',miss:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',smart:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',x:'<path d="M18 6L6 18M6 6l12 12"/>',doc:'<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',moon:'<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',dice:'<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',flame:'<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-4 3 1-4-1-8-4-9 0 4-3 6-3 11 0 4 3 9 7 9z"/>',trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>'};
P.eye='<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
P.eyeoff='<path d="M3 3l18 18M10.6 6.1A10 10 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 002 12s3.5 6 10 6c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 004.2 4.2"/>';
const ic=n=>`<svg class="ic" viewBox="0 0 24 24">${P[n]||''}</svg>`;
const T='font-family="Anek Bangla,Inter,sans-serif" font-weight="700" fill="currentColor"';
const ART={
bn:`<g class="fl"><path d="M5 11c7-2.5 13-1 19 3v23c-6-4-12-5.5-19-3.5z" fill="#fff"/><path d="M43 11c-7-2.5-13-1-19 3v23c6-4 12-5.5 19-3.5z" fill="#fff" opacity=".72"/><text x="10" y="30" font-size="15" ${T}>অ</text></g>`,
en:`<g class="fl"><path d="M8 8h32a4 4 0 014 4v18a4 4 0 01-4 4H25l-9 8v-8H8a4 4 0 01-4-4V12a4 4 0 014-4z" fill="#fff"/><text x="11" y="29" font-size="18" ${T}>Aa</text></g>`,
gk:`<circle cx="24" cy="24" r="17" fill="#fff" fill-opacity=".22" stroke="#fff" stroke-width="2.4"/><ellipse class="mer" cx="24" cy="24" rx="9" ry="17" fill="none" stroke="#fff" stroke-width="2"/><ellipse class="mer b" cx="24" cy="24" rx="9" ry="17" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/><path d="M7 24h34M10 14h28M10 34h28" stroke="#fff" stroke-width="2" fill="none"/>`,
iq:`<g stroke="#fff" stroke-width="2.6" stroke-linecap="round" class="gl"><path d="M24 1v4M6 8l3 3M42 8l-3 3M2 22h4M42 22h4"/></g><g class="fl"><path d="M24 8a12 12 0 00-7 21.7c1 .8 1.5 2 1.5 3.3h11c0-1.3.5-2.5 1.5-3.3A12 12 0 0024 8z" fill="#fff"/><rect x="18" y="37" width="12" height="3.5" rx="1.7" fill="#fff"/><path d="M21 22l3 4 3-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
bnl:`<g class="fl"><path d="M40 6C26 6 15 15 13 30l-5 10 10-5c15-2 24-13 22-29z" fill="#fff"/><path d="M13 36L31 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></g>`,
bng:`<g class="fl"><rect x="5" y="9" width="38" height="30" rx="9" fill="#fff"/><text x="9" y="31" font-size="17" ${T}>ব্যা</text></g>`,
enl:`<g class="fl"><path d="M5 11c7-2.5 13-1 19 3v23c-6-4-12-5.5-19-3.5z" fill="#fff"/><path d="M43 11c-7-2.5-13-1-19 3v23c6-4 12-5.5 19-3.5z" fill="#fff" opacity=".72"/><path d="M11 21c3-.8 6-.5 9 1M11 27c3-.8 6-.5 9 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`,
eng:`<g class="fl"><rect x="5" y="9" width="38" height="30" rx="9" fill="#fff"/><text x="11" y="29" font-size="16" ${T}>Gr</text><path d="M28 31h9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></g>`};
const tile=(k,g,sm)=>`<span class="tile ${sm?'sm':''}" style="--g1:${g[0]};--g2:${g[1]}"><svg viewBox="0 0 48 48">${ART[k]||ART.gk}</svg></span>`;
function ring(p,sz,sw,col,bg){const r=(sz-sw)/2,c=2*Math.PI*r;return `<svg width="${sz}" height="${sz}"><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${bg}" stroke-width="${sw}"/><circle class="rg" cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-o="${c*(1-p/100)}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"/></svg>`}
function burst(el,n=12){if(!el)return;const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,c=['#2563eb','#38bdf8','#10b981','#f59e0b','#8b5cf6'];for(let i=0;i<n;i++){const d=document.createElement('i');d.className='qbc-bs';const a=Math.PI*2*i/n,l=40+Math.random()*40;d.style.cssText=`left:${x}px;top:${y}px;background:${c[i%5]};--x:${Math.cos(a)*l}px;--y:${Math.sin(a)*l}px`;document.body.appendChild(d);setTimeout(()=>d.remove(),850)}}
function cu(el){const to=+el.dataset.cu,suf=el.dataset.s||'',t0=performance.now(),f=t=>{const p=Math.min(1,(t-t0)/900),e=1-Math.pow(1-p,3);el.textContent=Math.round(to*e)+suf;if(p<1)requestAnimationFrame(f)};requestAnimationFrame(f)}
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsq=s=>esc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
const C=()=>{try{if(typeof CACHE!=='undefined'&&CACHE)return CACHE}catch(e){}return window.CACHE||{subjects:[],topics:[],questions:[],mistakes:[],dailyStats:[],settings:{}}};
const PAL=[['#10b981','#059669'],['#8b5cf6','#6366f1'],['#3b82f6','#2563eb'],['#f59e0b','#f97316'],['#ec4899','#db2777'],['#14b8a6','#0d9488'],['#ef4444','#f97316'],['#64748b','#475569']];
function artFor(name,sub){const n=String(name||'').toLowerCase();
 if(/বাংলা|bangla|bengali/.test(n))return /ব্যাকরণ|grammar/.test(n)?'bng':(sub&&/সাহিত্য|literature/.test(n)?'bnl':'bn');
 if(/english|ইংরেজি/.test(n))return /grammar|গ্রামার|ব্যাকরণ/.test(n)?'eng':(sub&&/literature|সাহিত্য/.test(n)?'enl':'en');
 if(/iq|math|গণিত|যুক্তি/.test(n))return 'iq';
 return 'gk'}
function palFor(name,i){const n=String(name||'').toLowerCase();
 if(/বাংলা|bangla/.test(n))return PAL[0];if(/english|ইংরেজি/.test(n))return PAL[1];
 if(/সাধারণ|general|gk/.test(n))return PAL[2];if(/iq|math|গণিত/.test(n))return PAL[3];
 return PAL[(i+4)%PAL.length]}
/* ---------- progress state (synced via settings store) ---------- */
function QS_(){const s=C().settings||{};if(!s.qbankState||typeof s.qbankState!=='object')s.qbankState={};const q=s.qbankState;q.answers=q.answers&&typeof q.answers==='object'?q.answers:{};q.bm=q.bm&&typeof q.bm==='object'?q.bm:{};q.notes=q.notes&&typeof q.notes==='object'?q.notes:{};return q}
let saveT=0;
function saveState(){clearTimeout(saveT);saveT=setTimeout(()=>{try{const S=C().settings;if(!S)return;const q=QS_();const k=Object.keys(q.answers);if(k.length>6000){k.sort((a,b)=>(q.answers[a].at||0)-(q.answers[b].at||0)).slice(0,k.length-6000).forEach(x=>delete q.answers[x])}S.updatedAt=Date.now();if(typeof dbPut==='function')dbPut('settings',S).catch(e=>console.warn('[qbc] settings save failed',e))}catch(e){console.warn('[qbc]',e)}},400)}
const ansOf=id=>QS_().answers[id];
const isBm=id=>{const q=qById(id);return !!(QS_().bm[id]||(q&&q.bookmarked))};
/* ---------- catalogue from backend cache ---------- */
let MAP=null,MAPSIG='';
function sig(){const c=C();return [c.subjects.length,c.topics.length,c.questions.length,(c.questions[c.questions.length-1]||{}).id||''].join('|')}
function qById(id){build();return MAP.qid.get(String(id))}
function correctIdx(q){let r=q.answerIndex!=null?q.answerIndex:q.answer;if(typeof window.resolveAnswerIndex==='function'){const v=window.resolveAnswerIndex(r,q.options||[]);if(v!==null&&v!==undefined)return v}const n=Number(r);return Number.isFinite(n)?n:0}
function build(){const s=sig();if(MAP&&MAPSIG===s)return MAP;MAPSIG=s;
 const c=C(),qid=new Map(),byTopic=new Map();
 (c.questions||[]).forEach(q=>{if(!q||!q.id||!q.question||!Array.isArray(q.options)||q.options.length<2)return;if(q.deleted||q.deletedAt)return;qid.set(String(q.id),q);const k=String(q.topicId||'');if(!byTopic.has(k))byTopic.set(k,[]);byTopic.get(k).push(q)});
 byTopic.forEach(a=>a.sort((x,y)=>(Number(x.order)||0)-(Number(y.order)||0)||(x.createdAt||0)-(y.createdAt||0)));
 const topics=(c.topics||[]).filter(t=>t&&t.id),kids=new Map();topics.forEach(t=>{if(t.parentTopicId){const k=String(t.parentTopicId);kids.set(k,(kids.get(k)||0)+1)}});
 const subs=[...(c.subjects||[])].filter(s=>s&&s.id).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)).map((s,si)=>{
  const g=palFor(s.name,si),ts=topics.filter(t=>String(t.subjectId)===String(s.id));
  const leaves=ts.filter(t=>!kids.get(String(t.id))||(byTopic.get(String(t.id))||[]).length);
  const groups=new Map();
  leaves.forEach(t=>{const p=t.parentTopicId&&ts.find(x=>String(x.id)===String(t.parentTopicId));const key=p?String(p.id):'_';if(!groups.has(key))groups.set(key,{id:key,n:p?p.name:s.name,ic:artFor(p?p.name:s.name,1),t:[]});const n=(byTopic.get(String(t.id))||[]).length;groups.get(key).t.push({id:String(t.id),n:t.name,c:n,o:Number(t.order)||0})});
  const gs=[...groups.values()].map(G=>(G.t.sort((a,b)=>a.o-b.o||String(a.n).localeCompare(String(b.n),'bn')),G)).filter(G=>G.t.length);
  if(gs.length>1){const o=gs.findIndex(G=>G.id==='_');if(o>=0)gs[o].n='অন্যান্য'}
  return {id:String(s.id),n:s.name,ic:artFor(s.name),g,gs}}).filter(s=>s.gs.some(G=>G.t.length));
 MAP={qid,byTopic,subs};return MAP}
const SS=id=>build().subs.find(x=>x.id===String(id));
const topicQs=id=>build().byTopic.get(String(id))||[];
const tpct=id=>{const L=topicQs(id);if(!L.length)return 0;return Math.round(L.filter(q=>ansOf(q.id)).length/L.length*100)};
const sp=s=>{let a=0,n=0;s.gs.forEach(G=>G.t.forEach(t=>{a+=tpct(t.id);n++}));return n?Math.round(a/n):0};
const subjQs=s=>{const r=[];s.gs.forEach(G=>G.t.forEach(t=>r.push(...topicQs(t.id))));return r};
const allQs=()=>[...build().qid.values()];
function wrongIds(){const m=(C().mistakes||[]).filter(x=>x&&x.questionId&&!x.mastered&&build().qid.has(String(x.questionId))).sort((a,b)=>(b.lastWrongAt||b.time||0)-(a.lastWrongAt||a.time||0)).map(x=>String(x.questionId));const a=QS_().answers;Object.keys(a).forEach(k=>{if(!a[k].ok&&build().qid.has(k)&&!m.includes(k))m.push(k)});return m}
/* ---------- daily stats (backend) ---------- */
function tKey(d){return typeof window.todayKey==='function'?window.todayKey(d):new Date(d||Date.now()).toISOString().slice(0,10)}
function dayRow(k){return (C().dailyStats||[]).find(r=>String(r.id||r.date)===k)}
async function bumpDaily(ok){try{const k=tKey(),ex=dayRow(k)||{id:k,date:k,questions:0,correct:0,wrong:0,skipped:0,exams:0,timeMs:0};const nx={...ex,id:k,date:k,questions:Number(ex.questions||0)+1,correct:Number(ex.correct||0)+(ok?1:0),wrong:Number(ex.wrong||0)+(ok?0:1),practiceQuestions:Number(ex.practiceQuestions||0)+1,updatedAt:Date.now()};const L=C().dailyStats||(C().dailyStats=[]);const i=L.findIndex(r=>String(r.id||r.date)===k);i>=0?L[i]=nx:L.push(nx);if(typeof dbPut==='function')await dbPut('dailyStats',nx)}catch(e){console.warn('[qbc] daily',e)}}
async function recordMistake(q,sel,cor){try{const now=Date.now(),L=C().mistakes||(C().mistakes=[]);let m=L.find(x=>String(x.questionId)===String(q.id));if(!m){m={id:typeof uid==='function'?uid():'m-'+now.toString(36)+Math.random().toString(36).slice(2,7),questionId:q.id,wrongCount:0};L.push(m)}
 Object.assign(m,{question:q.question,options:q.options||[],subjectId:q.subjectId,topicId:q.topicId,correctAnswerIndex:cor,correctAnswer:(q.options||[])[cor]||'',wrongAnswer:(q.options||[])[sel]||'',selectedAnswer:(q.options||[])[sel]||'',explanation:q.explanation||'',wrongCount:Number(m.wrongCount||0)+1,lastWrongAt:now,time:now,status:'needs-review',revisionStatus:'pending',mastered:false,source:'question-bank',updatedAt:now});
 if(typeof dbPut==='function')await dbPut('mistakes',m)}catch(e){console.warn('[qbc] mistake',e)}}
async function bumpQuestionStats(q,ok){try{q.stats=q.stats||{attempts:0,correct:0,wrong:0};q.stats.attempts=Number(q.stats.attempts||0)+1;q.stats[ok?'correct':'wrong']=Number(q.stats[ok?'correct':'wrong']||0)+1;q.lastAttemptAt=Date.now();q.attempted=true;if(typeof dbPut==='function')await dbPut('questions',q)}catch(e){}}

/* ---------- theme + device chrome ---------- */
const isDark=()=>{try{const r=window.AhAppearance&&window.AhAppearance.resolved();return r==='dark'||r==='midnight'}catch(e){return false}};
const BG=()=>isDark()?'#090e1b':'#f4f6fb';
function chromeOn(){const de=document.documentElement;de.classList.add('qbc-active');const c=BG();document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute('content',c));de.style.setProperty('--ah-chrome',c);de.style.backgroundColor=c;if(document.body)document.body.style.backgroundColor=c;const r=document.getElementById('qbc');if(r)r.dataset.qtheme=isDark()?'dark':'light'}
function chromeOff(){const de=document.documentElement;if(!de.classList.contains('qbc-active'))return;de.classList.remove('qbc-active');de.style.backgroundColor='';try{window.AhAppearance&&window.AhAppearance.apply()}catch(e){}}
function toggleTheme(){try{window.AhAppearance&&window.AhAppearance.set(isDark()?'light':'dark')}catch(e){}chromeOn();document.querySelectorAll('#qbc .tb').forEach(b=>b.innerHTML=ic(isDark()?'sun':'moon'))}
const tb=()=>`<button class="ib tb" aria-label="থিম" onclick="QBC.theme()">${ic(isDark()?'sun':'moon')}</button>`;
function greet(){const h=new Date().getHours();return (h<5?'শুভ রাত্রি':h<12?'শুভ সকাল':h<16?'শুভ দুপুর':h<19?'শুভ বিকেল':'শুভ সন্ধ্যা')+' · আজ কী প্র্যাক্টিস করবেন?'}
/* ---------- routing ---------- */
const ROOT='question-bank';
function curPath(){return decodeURIComponent(String(location.hash||'').replace(/^#\/?/,'')).split('?')[0]}
function nav(p){if(typeof window.navigate==='function')window.navigate(p);else location.hash='#'+p}
function locateTopic(tid){for(const s of build().subs)for(let gi=0;gi<s.gs.length;gi++){const j=s.gs[gi].t.findIndex(t=>t.id===String(tid));if(j>=0)return {s,gi,j,t:s.gs[gi].t[j]}}return null}
function parse(){const p=curPath().split('/');const v=p[1]||'';
 if(v==='search')return {v:'search'};
 if(v==='subject'&&p[2]){const s=SS(p[2]);if(!s)return {v:'home'};return s.gs.length>1?{v:'groups',s:s.id}:{v:'topics',s:s.id,g:0}}
 if(v==='group'&&p[2]){const s=SS(p[2]);if(!s)return {v:'home'};const g=Math.max(0,Math.min(s.gs.length-1,Number(p[3])||0));return {v:'topics',s:s.id,g}}
 if(v==='topic'&&p[2]){const L=locateTopic(p[2]);if(!L)return {v:'home'};return {v:'practice',s:L.s.id,g:L.gi,t:L.t.id,tn:L.t.n}}
 if(v==='pool'&&p[2])return {v:'practice',pool:p[2],tn:POOLN[p[2]]||'প্র্যাক্টিস'};
 return {v:'home'}}
function parentOf(r){if(r.v==='practice'){if(r.pool)return ROOT;const s=SS(r.s);return s&&s.gs.length>1?ROOT+'/group/'+s.id+'/'+r.g:ROOT+'/subject/'+r.s}
 if(r.v==='topics'){const s=SS(r.s);return s&&s.gs.length>1?ROOT+'/subject/'+r.s:ROOT}return ROOT}
let st={v:'home',f:'all'},R={},POOLS={},lastKey='',dir='';
const POOLN={mistake:'ভুলের ব্যাংক',smart:'স্মার্ট রিভিশন',bm:'বুকমার্ক',random:'র‍্যান্ডম কুইজ',weak:'দুর্বল অংশ',daily:'দৈনিক চ্যালেঞ্জ'};
function up(){dir='back';nav(parentOf(st))}
function go(p){dir='';nav(p)}
function openS(id){go(ROOT+'/subject/'+id)}
function openT(id){go(ROOT+'/topic/'+id)}
function shuffle(a,seed){const r=a.slice();let s=seed||Math.random()*1e9|0;const rnd=()=>seed?((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff):Math.random();for(let i=r.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[r[i],r[j]]=[r[j],r[i]]}return r}
function weakest(){const L=build().subs.filter(s=>subjQs(s).length);return L.sort((a,b)=>sp(a)-sp(b))[0]}
function makePool(m){const A=QS_().answers;let ids=[];
 if(m==='mistake')ids=wrongIds();
 else if(m==='bm')ids=allQs().filter(q=>isBm(q.id)).map(q=>String(q.id));
 else if(m==='smart'){const w=wrongIds().slice(0,15);const n=shuffle(allQs().filter(q=>!A[q.id]).map(q=>String(q.id))).slice(0,Math.max(5,20-w.length));ids=[...new Set([...w,...n])]}
 else if(m==='random')ids=shuffle(allQs().map(q=>String(q.id))).slice(0,5);
 else if(m==='weak'){const s=weakest();ids=s?shuffle(subjQs(s).map(q=>String(q.id))).slice(0,5):[]}
 else if(m==='daily'){const k=tKey();let seed=0;for(const ch of k)seed=(seed*31+ch.charCodeAt(0))&0x7fffffff;ids=shuffle(allQs().map(q=>String(q.id)).sort(),seed||7).slice(0,5)}
 return ids}
function startPool(m){const ids=makePool(m);if(!ids.length)return toast(m==='bm'?'এখনো কোনো বুকমার্ক নেই।':m==='mistake'?'কোনো ভুল নেই। দারুণ চলছে! 🎉':'এখনো কোনো প্রশ্ন নেই।');POOLS[m]=ids;go(ROOT+'/pool/'+m)}
/* ---------- views ---------- */
function head(inner,extra){return `<div class="head">${inner}${extra||''}</div>`}
function carousel(){
 const c=C(),A=QS_().answers,target=Math.max(1,Number((c.settings||{}).dailyTarget)||20),td=dayRow(tKey())||{},tot=Number(td.questions||0),okT=Number(td.correct||0),wrT=Number(td.wrong||0),goal=Math.min(100,Math.round(tot/target*100));
 const okAll=Object.values(A).filter(a=>a.ok).length,xp=okAll*10,lv=Math.floor(xp/100)+1,nx=xp%100;
 const now=new Date(),d=now.getDay(),days=['রবি','সোম','মঙ্গল','বুধ','বৃহ','শুক্র','শনি'];
 const vals=days.map((_,i)=>{if(i>d)return 0;const dt=new Date(now);dt.setDate(now.getDate()-(d-i));return Number((dayRow(tKey(dt))||{}).questions||0)});
 const mx=Math.max(10,...vals),wt=vals.reduce((a,b)=>a+b,0),bi=vals.indexOf(Math.max(...vals));
 const W=wrongIds(),w=W.slice(0,2).map(qById).filter(Boolean),bl='<i class="bl x"></i><i class="bl y"></i>';
 const dp=POOLS.daily||makePool('daily'),done=dp.filter(id=>{const a=A[id];return a&&tKey(a.at)===tKey()}).length;
 const S=build().subs;
 return `<div class="cs" id="cs">
<div class="sl" style="--a:#4f46e5;--b:#2563eb;--c:#38bdf8">${bl}<div class="shd"><span class="k">${ic('flame')}আজকের লক্ষ্য</span><span class="chp">Lv <b class="n">${lv}</b></span></div>
<div class="body1"><div class="ring">${ring(goal,108,10,'#fff','rgba(255,255,255,.25)')}<b class="n" style="font-size:24px;font-weight:800" data-cu="${goal}" data-s="%">${goal}%</b></div>
<div class="sr"><div>${ic('check')}সঠিক<b class="n" data-cu="${okT}">${okT}</b></div><div>${ic('x')}ভুল<b class="n" data-cu="${wrT}">${wrT}</b></div><div>${ic('doc')}সম্পন্ন<b class="n">${tot}/${target}</b></div></div></div>
<div class="xpr"><div class="l"><span>XP <b class="n">${xp}</b></span><span>পরের লেভেলে <b class="n">${100-nx}</b></span></div><div class="xp"><i style="--w:${nx}%"></i></div></div></div>
<div class="sl" style="--a:#047857;--b:#14b8a6;--c:#6ee7b7">${bl}<div class="shd"><span class="k">${ic('smart')}এই সপ্তাহ</span><span class="chp">সেরা: ${days[bi]} <b class="n">${vals[bi]}</b></span></div>
<div><span class="big n" data-cu="${wt}">${wt}</span> <span style="font-weight:600;opacity:.9">টি প্রশ্ন</span></div>
<div class="wb">${vals.map((v,i)=>`<div onclick="this.parentNode.querySelectorAll('div').forEach(x=>x.classList.remove('sel'));this.classList.add('sel')"><b class="n">${v}</b><i class="${i===d?'t':''}" style="--h:${Math.round(v/mx*100)}%"></i>${days[i]}</div>`).join('')}</div></div>
<div class="sl" style="--a:#7c3aed;--b:#db2777;--c:#f0abfc">${bl}<div class="shd"><span class="k">${ic('trophy')}বিষয়ভিত্তিক দক্ষতা</span><button class="chp" onclick="QBC.pool('weak')">দুর্বল অংশ ${ic('chev')}</button></div>
${S.slice(0,4).map(s=>`<button class="mr" onclick="QBC.subject('${jsq(s.id)}')">${tile(s.ic,s.g,1)}<span class="mi"><span class="mn"><span>${esc(s.n)}</span><b class="n">${sp(s)}%</b></span><span class="bp" style="display:block"><i style="--w:${sp(s)}%"></i></span></span></button>`).join('')}</div>
<div class="sl" style="--a:#be123c;--b:#f97316;--c:#fdba74">${bl}<div class="shd"><span class="k">${ic('miss')}ভুল থেকে শিখুন</span></div>
<div><span class="big n" data-cu="${W.length}">${W.length}</span> <span style="font-weight:600;opacity:.9">টি ভুল প্রশ্ন</span></div>
${w.length?w.map(q=>`<div class="mq">${ic('x')}<span>${esc(q.question)}</span></div>`).join(''):'<div class="mq">🎉 <span>কোনো ভুল নেই। দারুণ চলছে!</span></div>'}
<button class="cbtn" onclick="QBC.pool('${w.length?'mistake':'random'}')">${w.length?'ভুল ঠিক করুন':'র‍্যান্ডম কুইজ'} ${ic('chev')}</button></div>
<div class="sl" style="--a:#b45309;--b:#f59e0b;--c:#fde68a">${bl}<div class="shd"><span class="k">${ic('smart')}দৈনিক চ্যালেঞ্জ</span><span class="chp">${done>=5?'সম্পন্ন ✓':'+50 XP'}</span></div>
<h3>আজকের ৫টি প্রশ্ন</h3><p>সবগুলো শেষ করে বোনাস XP জিতুন</p>
<div class="stp">${[1,2,3,4,5].map(i=>`<i class="${i<=done?'d':''}">${i<=done?'✓':i}</i>`).join('')}</div>
<button class="cbtn pl" onclick="QBC.pool('daily')">${done>=5?'আবার দেখুন':'শুরু করুন'} ${ic('chev')}</button></div>
</div>`}
function quick(){const W=wrongIds().length,Bn=allQs().filter(q=>isBm(q.id)).length;const m=[['mistake','ভুলের ব্যাংক',W+'টি ভুল','#ef4444','#f97316','miss'],['smart','স্মার্ট রিভিশন','ভুল + নতুন','#6366f1','#2563eb','smart'],['bm','বুকমার্ক',Bn+'টি সেভ','#f59e0b','#f97316','star'],['random','র‍্যান্ডম কুইজ','৫টি প্রশ্ন','#10b981','#0d9488','dice']];
 return `<div class="sec"><span>দ্রুত শুরু</span></div><div class="qk">${m.map((x,i)=>`<button style="animation-delay:${i*60}ms" onclick="QBC.pool('${x[0]}')"><span class="tile" style="--g1:${x[3]};--g2:${x[4]}"><svg viewBox="0 0 24 24" style="stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;width:22px;height:22px">${P[x[5]]}</svg></span><span><b>${x[1]}</b><small>${x[2]}</small></span></button>`).join('')}</div>`}
function emptyAll(){return `<div class="empty">${ic('doc')}<p style="margin:10px 0 0;font-weight:600">এখনো কোনো প্রশ্ন যোগ করা হয়নি</p><p style="margin:4px 0 0;font-size:13px">প্রশ্ন যোগ হলে এখানে স্বয়ংক্রিয়ভাবে দেখা যাবে।</p></div>`}
function home(){const S=build().subs;
 const top=`<div class="top"><div class="tt"><h1 class="gt">প্রশ্ন ব্যাংক</h1><p class="sub">${greet()}</p></div><button class="ib" aria-label="খুঁজুন" onclick="QBC.go('${ROOT}/search')">${ic('search')}</button>${tb()}</div>`;
 if(!S.length)return head(top)+emptyAll();
 return head(top)+`<div class="st"><div>${carousel()}</div><div>${quick()}</div>
 <div><div class="sec"><span>সব বিষয়</span><span>${S.length}টি বিষয়</span></div>
 <div class="grid">${S.map((s,k)=>{const n=subjQs(s).length,tc=s.gs.reduce((a,g)=>a+g.t.length,0);return `<button class="sc" style="--g1:${s.g[0]};--g2:${s.g[1]};animation:qbc-up .55s ${k*70}ms both" onclick="QBC.subject('${jsq(s.id)}')">${tile(s.ic,s.g)}<b>${esc(s.n)}</b><small>${s.gs.length>1?s.gs.length+'টি বিষয় · ':''}${tc} টপিক · ${n} প্রশ্ন</small><div class="bar"><i data-w="${sp(s)}%"></i></div></button>`}).join('')}</div></div></div>`}
function backBtn(){return `<button class="ib" aria-label="পিছনে" onclick="QBC.up()">${ic('back')}</button>`}
function groups(){const s=SS(st.s);return head(`<div class="top">${backBtn()}<div class="tt"><h1>${esc(s.n)}</h1><p class="sub">একটি বিষয় বেছে নিন</p></div>${tb()}</div>`)+`<div class="st">${s.gs.map((g,gi)=>{const n=g.t.reduce((a,x)=>a+x.c,0);return `<button class="sc" style="--g1:${s.g[0]};--g2:${s.g[1]};margin-bottom:12px;display:flex;gap:16px;align-items:center;animation-delay:${gi*80}ms" onclick="QBC.go('${ROOT}/group/${jsq(s.id)}/${gi}')">${tile(g.ic,s.g)}<span style="flex:1"><b style="margin:0">${esc(g.n)}</b><small>${g.t.length} টপিক · ${n} প্রশ্ন</small></span><span class="chev">${ic('chev')}</span></button>`}).join('')}</div>`}
function topicBtn(s,g,t,j,sub){const p=tpct(t.id);return `<button class="tc" style="--g1:${s.g[0]};--g2:${s.g[1]};animation-delay:${j*55}ms" onclick="QBC.topic('${jsq(t.id)}')">${tile(g.ic,s.g,1)}<span class="t"><b>${esc(t.n)}</b><small>${sub?esc(g.n)+' · ':''}${t.c} প্রশ্ন · ${p}% সম্পন্ন</small><div class="bar" style="margin-top:10px"><i data-w="${p}%"></i></div></span><span class="chev">${ic('chev')}</span></button>`}
function topics(){const s=SS(st.s),g=s.gs[st.g]||s.gs[0];return head(`<div class="top">${backBtn()}<div class="tt"><h1>${esc(g.id==='_'?s.n:g.n)}</h1><p class="sub">${g.t.length} টপিক · ${g.t.reduce((a,x)=>a+x.c,0)} প্রশ্ন</p></div>${tb()}</div>`)+`<div class="st">${g.t.map((t,j)=>topicBtn(s,g,t,j)).join('')}</div>`}
function search(){return head(`<div class="top">${backBtn()}<div class="tt"><h1 class="s">খুঁজুন</h1></div>${tb()}</div>`,`<div class="search">${ic('search')}<input type="search" enterkeyhint="search" placeholder="টপিক খুঁজুন…" oninput="QBC.find(this.value)"></div>`)+`<div id="gr" class="empty">টপিকের নাম লিখুন</div>`}
function find(v){const r=[],q=String(v||'').trim().toLowerCase();if(q)build().subs.forEach(s=>s.gs.forEach(g=>g.t.forEach((t,j)=>{if(String(t.n).toLowerCase().includes(q)||String(s.n).toLowerCase().includes(q))r.push(topicBtn(s,g,t,Math.min(r.length,8),1))})));const e=document.getElementById('gr');if(!e)return;e.className=r.length?'':'empty';e.innerHTML=r.slice(0,80).join('')||(q?'কিছু পাওয়া যায়নি':'টপিকের নাম লিখুন')}

/* ---------- practice ---------- */
function base(){if(st.pool){if(!POOLS[st.pool])POOLS[st.pool]=makePool(st.pool);return POOLS[st.pool].filter(id=>build().qid.has(id))}return topicQs(st.t).map(q=>String(q.id))}
function filt(){let L=base();const f=st.f;if(f==='new')L=L.filter(id=>!ansOf(id));if(f==='bad')L=L.filter(id=>ansOf(id)&&!ansOf(id).ok);if(f==='bm')L=L.filter(isBm);return L}
function chips(){const b=base(),c={all:b.length,new:b.filter(id=>!ansOf(id)).length,bad:b.filter(id=>ansOf(id)&&!ansOf(id).ok).length,bm:b.filter(isBm).length};
 return [['all','সব'],['new','নতুন'],['bad','ভুল'],['bm','বুকমার্ক']].map(([k,n])=>`<button class="fc ${st.f===k?'on':''}" onclick="QBC.filter('${k}')">${n} <span class="n">${c[k]}</span></button>`).join('')}
function practice(){return head(`<div class="top">${backBtn()}<div class="tt"><h1 class="s">${esc(st.tn)}</h1></div>${tb()}</div>`,`<div class="fch" id="qbc-ch"></div>`)+`<div id="qbc-ql">${list()}</div>`}
const PAGE=40;let shown=PAGE;
function list(){const L=filt();if(!L.length)return `<div class="empty">${base().length?'এই ফিল্টারে কোনো প্রশ্ন নেই':'এই অংশে এখনো কোনো প্রশ্ন নেই'}</div>`;return L.slice(0,shown).map((id,i)=>card(id,i,0,1)).join('')+(L.length>shown?`<div class="sk" id="qbc-more" style="height:60px"></div>`:'')}
function card(id,idx,anim,open){const q=qById(id);if(!q)return '';const a=ansOf(id),rv=!a&&R[id],cor=correctIdx(q),stx=a?(a.ok?'ok':'no'):rv?'rv':'',note=QS_().notes[id]||'',k=jsq(id);
 return `<div class="qc ${anim?'in':''} ${a?(a.ok?'ok':'no'):''}" data-k="${esc(id)}"><div class="qh"><span class="qb n">${String(idx+1).padStart(2,'0')}</span><span class="stt ${stx}">${a?(a.ok?'সঠিক':'ভুল'):rv?'উত্তর দেখছেন':'নতুন'}</span><button class="bkb ${isBm(id)?'on':''}" aria-label="বুকমার্ক" onclick="QBC.bm('${k}',this)">${ic('star')}</button></div>
 <p class="q">${esc(q.question)}</p>${(q.options||[]).map((o,j)=>{let c='';if(a)c=j===cor?'ok':j===a.c?'no':'dim';else if(rv)c=j===cor?'rv':'dim';return `<button class="opt ${c}" ${a||rv?'disabled':''} onclick="QBC.pick('${k}',${j})"><span class="l n">${'ABCDEFGH'[j]||j+1}</span><span class="tx">${esc(o)}</span><span class="mk">${ic(j===cor?'check':'x')}</span></button>`}).join('')}
 <div class="ex ${(a&&open)||rv?'open':''}"><div><div class="exp"><span class="ei">${ic('bulb')}</span><div><b>ব্যাখ্যা</b><p>${(a&&!a.ok)||rv?'সঠিক উত্তর: '+esc((q.options||[])[cor]||'')+'। ':''}${esc(q.explanation||'')||(a&&a.ok?'সঠিক উত্তর দিয়েছেন।':'')}</p></div></div></div></div>
 <div class="ft">${a?'':`<button class="ab ${rv?'on':''}" onclick="QBC.show('${k}')">${ic(rv?'eyeoff':'eye')}<span>${rv?'উত্তর লুকান':'উত্তর দেখুন'}</span></button>`}<button class="ab" onclick="QBC.noteToggle(this)">${ic('doc')}<span>${note?'নোট দেখুন':'নোট করুন'}</span></button></div><textarea class="ta" placeholder="আপনার নোট লিখুন…" oninput="QBC.note('${k}',this.value)">${esc(note)}</textarea></div>`}
function replaceCard(id,openEx){const el=document.querySelector(`#qbc .qc[data-k="${CSS.escape(id)}"]`);if(!el)return null;const idx=[...document.querySelectorAll('#qbc .qc')].indexOf(el);el.outerHTML=card(id,idx,1,0);const n=document.querySelector(`#qbc .qc[data-k="${CSS.escape(id)}"]`);if(n&&openEx)requestAnimationFrame(()=>requestAnimationFrame(()=>{const e=n.querySelector('.ex');e&&e.classList.add('open')}));return n}
function show(id){R[id]=!R[id];replaceCard(id,R[id])}
function pick(id,j){if(ansOf(id))return;const q=qById(id);if(!q)return;const cor=correctIdx(q),ok=j===cor;QS_().answers[id]={c:j,ok,at:Date.now(),t:String(q.topicId||'')};delete R[id];saveState();
 bumpDaily(ok);bumpQuestionStats(q,ok);if(!ok)recordMistake(q,j,cor);
 try{window.dispatchEvent(new CustomEvent('admission:activity',{detail:{type:'QUESTION_PRACTICED',questionId:q.id,subjectId:q.subjectId,topicId:q.topicId,correct:ok,day:tKey(),source:'question-bank'}}))}catch(e){}
 const n=replaceCard(id,1);if(navigator.vibrate)try{navigator.vibrate(ok?12:[25,35,25])}catch(e){}if(ok&&n)burst(n.querySelector('.opt.ok .l'));refresh();
 setTimeout(()=>{const e=document.getElementById('qbc-endc');if(e)e.scrollIntoView({behavior:'smooth',block:'center'})},750)}
function bm(id,b){const q=qById(id),S=QS_();const on=!isBm(id);if(on)S.bm[id]=1;else delete S.bm[id];if(q){q.bookmarked=on;q.bookmarkUpdatedAt=Date.now();if(typeof dbPut==='function')dbPut('questions',q).catch(()=>{})}saveState();b.classList.toggle('on',on);toast(on?'বুকমার্ক করা হয়েছে':'বুকমার্ক সরানো হয়েছে');refresh()}
let noteT=0;function note(id,v){const N=QS_().notes;v&&v.trim()?N[id]=v.slice(0,2000):delete N[id];clearTimeout(noteT);noteT=setTimeout(saveState,600)}
function noteToggle(b){const t=b.closest('.qc').querySelector('.ta');t.classList.toggle('show');if(t.classList.contains('show'))t.focus({preventScroll:true})}
function refresh(){const ch=document.getElementById('qbc-ch');if(ch)ch.innerHTML=chips();endCard()}
function endCard(){const old=document.getElementById('qbc-endc'),b=base();if(!b.length){if(old)old.remove();return}const d=b.filter(ansOf),ok=d.filter(id=>ansOf(id).ok).length;
 if(st.f!=='all'||d.length<b.length){if(old)old.remove();return}if(old)return;const p=Math.round(ok/b.length*100),ql=document.getElementById('qbc-ql');if(!ql)return;
 ql.insertAdjacentHTML('beforeend',`<div class="endc" id="qbc-endc"><div class="ring" style="margin:auto">${ring(p,110,10,'#2563eb','var(--line)')}<b class="n" style="font-size:24px;font-weight:800">${p}%</b></div><h3>${p>=80?'অসাধারণ! 🏆':p>=50?'ভালো করেছেন 👏':'আরও চর্চা দরকার 💪'}</h3><p class="sub">${b.length}টির মধ্যে ${ok}টি সঠিক</p><div class="row"><button class="btn" onclick="QBC.up()">ফিরে যান</button><button class="btn p" onclick="QBC.redo()">আবার করুন</button></div></div>`);
 requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelectorAll('#qbc-endc .rg').forEach(e=>e.style.strokeDashoffset=e.dataset.o)}));if(p>=60)setTimeout(()=>burst(document.querySelector('#qbc-endc .ring'),24),500)}
function redo(){const A=QS_().answers;base().forEach(id=>delete A[id]);R={};saveState();if(st.pool&&st.pool!=='daily')POOLS[st.pool]=makePool(st.pool);shown=PAGE;paintList()}
function setF(f){st.f=f;shown=PAGE;paintList()}
function paintList(){const ql=document.getElementById('qbc-ql');if(!ql)return;ql.innerHTML=list();refresh();reveal();more()}
let io=null,moreIO=null;
function reveal(){if(io)io.disconnect();if(!('IntersectionObserver' in window)){document.querySelectorAll('#qbc .qc').forEach(c=>c.classList.add('in'));return}io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.06});document.querySelectorAll('#qbc .qc:not(.in)').forEach(c=>io.observe(c));setTimeout(()=>document.querySelectorAll('#qbc .qc:not(.in)').forEach(c=>{if(c.getBoundingClientRect().top<innerHeight*1.2)c.classList.add('in')}),900)}
function more(){if(moreIO)moreIO.disconnect();const s=document.getElementById('qbc-more');if(!s||!('IntersectionObserver' in window))return;moreIO=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){moreIO.disconnect();const L=filt(),from=shown;shown+=PAGE;s.remove();const ql=document.getElementById('qbc-ql');ql.insertAdjacentHTML('beforeend',L.slice(from,shown).map((id,i)=>card(id,from+i,0,1)).join('')+(L.length>shown?`<div class="sk" id="qbc-more" style="height:60px"></div>`:''));reveal();more();endCard()}},{rootMargin:'600px 0px'});moreIO.observe(s)}
/* ---------- carousel ---------- */
let carT,carI=-1,carHold=0,carAnim=0;
function carGo(cs,to,dur){const from=cs.scrollLeft,t0=performance.now(),id=++carAnim,ease=p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;cs.style.scrollSnapType='none';const f=t=>{if(id!==carAnim)return;const p=Math.min(1,(t-t0)/dur);cs.scrollLeft=from+(to-from)*ease(p);if(p<1)requestAnimationFrame(f);else cs.style.scrollSnapType=''};requestAnimationFrame(f)}
function carInit(){const cs=document.getElementById('cs');if(!cs)return;const sl=[...cs.children];let raf=0;carI=-1;
 const set=i=>{carI=i;sl.forEach((s,k)=>s.classList.toggle('act',k===i));const s=sl[i];s.querySelectorAll('[data-cu]').forEach(cu);s.querySelectorAll('.rg').forEach(e=>{e.style.transition='none';e.style.strokeDashoffset=e.getAttribute('stroke-dasharray');e.getBoundingClientRect();e.style.transition='';requestAnimationFrame(()=>e.style.strokeDashoffset=e.dataset.o)})};
 const upd=()=>{raf=0;const c=cs.getBoundingClientRect(),mid=c.left+c.width/2;let best=0,bd=1e9;sl.forEach((s,k)=>{const r=s.getBoundingClientRect(),d=Math.abs(r.left+r.width/2-mid);if(d<bd){bd=d;best=k}const m=Math.min(1,d/r.width);s.style.transform=`scale(${1-m*.07})`;s.style.opacity=1-m*.4});if(best!==carI)set(best)};
 cs.addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(upd)},{passive:true});
 ['touchstart','pointerdown','wheel'].forEach(e=>cs.addEventListener(e,()=>{carAnim++;cs.style.scrollSnapType='';carHold=Date.now()+5000},{passive:true}));
 upd();clearTimeout(carT);
 const tick=()=>{const el=document.getElementById('cs');if(!el||el!==cs)return;if(Date.now()>=carHold&&!document.hidden){carGo(cs,((carI+1)%sl.length)*(sl[0].offsetWidth+12),650)}carT=setTimeout(tick,2800)};
 carT=setTimeout(tick,2200)}
/* ---------- toast ---------- */
let toastT=0;function toast(m){const t=document.getElementById('qbc-toast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2300)}
/* ---------- render ---------- */
function routeKey(r){return [r.v,r.s||'',r.g||0,r.t||'',r.pool||''].join('/')}
function render(){
 if(window.__admissionFinalModulesReady===false&&typeof window.renderStartupLoading==='function')return window.renderStartupLoading();
 const r=parse(),key=routeKey(r);
 if(key===lastKey&&r.v==='practice'&&document.getElementById('qbc')&&document.getElementById('qbc-ql')){chromeOn();refresh();return document.getElementById('qbc')}
 const changed=key!==lastKey;lastKey=key;
 if(changed){if(r.v==='practice'){st.f='all';shown=PAGE;R={}}if(!(r.v==='practice'&&r.pool))POOLS={...POOLS,random:undefined,weak:undefined,smart:undefined,mistake:undefined,bm:undefined}}
 if(r.v==='practice'&&r.pool&&changed&&!POOLS[r.pool])POOLS[r.pool]=makePool(r.pool);
 st=Object.assign({},st,{v:r.v,s:r.s,g:r.g||0,t:r.t,tn:r.tn,pool:r.pool||null});
 const view=({home,groups,topics,practice,search})[r.v]||home;
 const html=`<div id="qbc" class="${dir==='back'?'back':''}" data-qtheme="${isDark()?'dark':'light'}"><div class="qbc-in"><div class="screen">${view()}</div></div><div class="toast" id="qbc-toast"></div></div>`;dir='';
 if(typeof window.renderShell==='function')window.renderShell(html,{topbar:false,hideNav:r.v==='practice'});else{const a=document.getElementById('app');if(a)a.innerHTML=html}
 chromeOn();if(changed){try{window.scrollTo(0,0)}catch(e){}}
 requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelectorAll('#qbc .rg').forEach(e=>e.style.strokeDashoffset=e.dataset.o);document.querySelectorAll('#qbc .bar i').forEach(e=>e.style.width=e.dataset.w);if(r.v==='practice'){refresh();reveal();more()}if(r.v==='home')carInit();if(r.v==='search'){const i=document.querySelector('#qbc .search input');if(i)i.focus({preventScroll:true})}}));
 return document.getElementById('qbc')}
/* ---------- zoom / drift lock while the bank is open ---------- */
const active=()=>document.documentElement.classList.contains('qbc-active');
['gesturestart','gesturechange','gestureend'].forEach(t=>document.addEventListener(t,e=>{if(active())e.preventDefault()},{passive:false}));
document.addEventListener('touchmove',e=>{if(active()&&e.touches&&e.touches.length>1)e.preventDefault()},{passive:false});
document.addEventListener('dblclick',e=>{if(active())e.preventDefault()},{passive:false});
document.addEventListener('wheel',e=>{if(active()&&e.ctrlKey)e.preventDefault()},{passive:false});
/* ---------- route authority ---------- */
window.QBC={go,up,subject:openS,topic:openT,pool:startPool,pick,show,bm,note,noteToggle,filter:setF,redo,find,theme:toggleTheme,render,_parse:parse};
const isQB=()=>{const p=curPath();return p===ROOT||p.indexOf(ROOT+'/')===0};
try{Object.defineProperty(window,'renderQuestionBankV2',{configurable:true,get(){return render},set(){/* clean UI owns this route */}})}catch(e){window.renderQuestionBankV2=render}
try{window.renderQuestionBank=render}catch(e){}
const entry={openRedesignedSubject:id=>openS(id),phase3OpenSubject:id=>openS(id),openRedesignedTopic:id=>openT(id),phase3OpenTopic:id=>openT(id),leaveQuestionTopic:()=>go(ROOT)};
Object.keys(entry).forEach(k=>{try{Object.defineProperty(window,k,{configurable:true,get(){return entry[k]},set(){}})}catch(e){window[k]=entry[k]}});
document.addEventListener('admission:route-rendered',e=>{const p=String((e.detail&&e.detail.path)||'');if(!(p===ROOT||p.indexOf(ROOT+'/')===0))chromeOff()});
window.addEventListener('hashchange',()=>{if(!isQB()){chromeOff();lastKey=''}});
window.addEventListener('ah:appearance',()=>{if(active())chromeOn()});
if(isQB()&&window.__admissionFinalModulesReady!==false)setTimeout(()=>{if(isQB())render()},0);
})();
