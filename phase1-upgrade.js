/* 🗑 NO SPLASH (v178): পুরনো phase1-splash ওভারলে চিরতরে সরানো হয়েছে -
   ভাইয়ের নির্দেশ: কোনো ইন্ট্রো/স্প্ল্যাশ আসবে না। */
(function(){
  'use strict';
  const THEME_KEY='admission_theme_v1';
  const themes={
    'emerald-glass':{label:'Emerald Glass'},
    'midnight-academic':{label:'Midnight Academic'},
    'ivory-academic':{label:'Ivory Academic'}
  };
  const aliases={light:'emerald-glass',dark:'midnight-academic',midnight:'midnight-academic',focus:'ivory-academic',pink:'ivory-academic'};
  const canonical=t=>themes[t]?t:(aliases[t]||'emerald-glass');
  const readTheme=()=>{try{return canonical(localStorage.getItem(THEME_KEY)||window.CACHE?.settings?.theme||'emerald-glass')}catch(_){return 'emerald-glass'}};
  window.readTheme=readTheme;
  const THEME_THEMECOLOR={'emerald-glass':'#edf7f1','midnight-academic':'#081411','ivory-academic':'#fbf8f0'};
  function syncThemeColor(t){const c=THEME_THEMECOLOR[t]||'#edf7f1';let m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}m.setAttribute('content',c);document.documentElement.style.backgroundColor=c;document.body&&(document.body.style.backgroundColor=c)}
  window.__syncThemeColor=syncThemeColor;
  function applyThemeClass(theme){const t=canonical(theme);document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='midnight-academic'?'dark':'light';document.body?.setAttribute('data-theme',t);syncThemeColor(t);try{localStorage.setItem(THEME_KEY,t);if(window.CACHE?.settings)window.CACHE.settings.theme=t}catch(_){ }return t}
  window.applyTheme=()=>applyThemeClass(readTheme());
  window.setTheme=async function(theme){const t=applyThemeClass(theme);try{if(window.CACHE?.settings&&typeof window.dbPut==='function'){window.CACHE.settings.theme=t;await window.dbPut('settings',window.CACHE.settings)}}catch(_){ }if(typeof window.render==='function')window.render();if(typeof window.toast==='function')window.toast(themes[t].label+' applied')};
  const css=document.createElement('style');css.id='phase1-upgrade-styles';css.textContent=`
    :root{--glass-bg:rgba(255,255,255,.72);--glass-strong:rgba(255,255,255,.88);--glass-border:rgba(15,107,79,.16);--glass-shadow:0 14px 40px rgba(15,70,50,.10);--safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px)}
    [data-theme="emerald-glass"]{--bg:#edf7f1;--card:#fff;--text:#10251d;--sub:#5d7569;--line:rgba(20,93,68,.16);--mint:#e3f3eb;--emerald:#0f6b4f;--emerald-d:#084b38;--green:#178454;--glass-bg:rgba(255,255,255,.68);--glass-strong:rgba(255,255,255,.90);--glass-border:rgba(15,107,79,.18);--glass-shadow:0 16px 42px rgba(17,77,55,.12)}
    [data-theme="midnight-academic"]{--bg:#081411;--card:#12221d;--text:#e9f7ef;--sub:#9ab8aa;--line:rgba(159,220,190,.18);--mint:#17342a;--emerald:#39c98a;--emerald-d:#8aefbb;--green:#62d69a;--glass-bg:rgba(18,39,32,.76);--glass-strong:rgba(19,47,38,.92);--glass-border:rgba(138,239,187,.18);--glass-shadow:0 16px 42px rgba(0,0,0,.28)}
    [data-theme="ivory-academic"]{--bg:#fbf8f0;--card:#fffdf8;--text:#25352d;--sub:#718078;--line:rgba(55,82,68,.15);--mint:#edf4ee;--emerald:#176c50;--emerald-d:#0b4f3b;--green:#29835d;--glass-bg:rgba(255,253,248,.82);--glass-strong:rgba(255,255,251,.95);--glass-border:rgba(23,108,80,.16);--glass-shadow:0 14px 36px rgba(81,74,45,.10)}
    html,body{background:var(--bg);color:var(--text)}body{padding-top:var(--safe-t);padding-bottom:var(--safe-b);transition:background-color .22s ease,color .22s ease}.page{max-width:760px}.card,.metric-card,.command-tile,.command-card,.choice,.upgrade-card,.phase-card,.modal-card,.bottomnav,.topbar,.input-card{background:var(--glass-bg);border-color:var(--glass-border);box-shadow:var(--glass-shadow);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}input,textarea,select{background:var(--glass-strong)!important;color:var(--text)!important;border-color:var(--glass-border)!important}button,.chip,.btn{transition:transform .16s cubic-bezier(.23,1,.32,1),box-shadow .16s ease,background-color .16s ease}.btn,.chip.active{background:var(--emerald);border-color:var(--emerald);color:#fff}.btn:active,.chip:active,.command-tile:active,.command-card:active{transform:scale(.97)}
    .phase1-theme-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.phase1-theme-row .chip{flex:1 1 145px;min-height:42px;white-space:normal}.phase1-theme-row .chip.active{box-shadow:0 0 0 3px color-mix(in srgb,var(--emerald) 18%,transparent)}
    .command-carousel{position:relative;display:block;overflow:hidden;width:100%;max-width:100%;touch-action:pan-y;overscroll-behavior-x:contain;contain:layout paint}.command-track{display:flex!important;width:100%;max-width:none!important;transition:transform .28s cubic-bezier(.23,1,.32,1);will-change:transform}    .command-slide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:minmax(96px,auto);align-content:start;gap:10px;padding:1px;min-width:0}.command-slide>*{min-width:0}.command-carousel .command-card,.command-carousel .command-tile{min-width:0;max-width:100%}.command-dots{display:flex;justify-content:center;gap:6px;margin:9px 0 1px}.command-dot{width:7px;height:7px;border:0;border-radius:50%;padding:0;background:var(--line);cursor:pointer}.command-dot.active{width:20px;border-radius:9px;background:var(--emerald)}
    @media(max-width:520px){.command-slide{grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(88px,auto);gap:7px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
  `;document.head.appendChild(css);applyThemeClass(readTheme());
  function themeControls(){const rows=[...document.querySelectorAll('.filter-row')];const row=rows.find(x=>[...x.querySelectorAll('[onclick]')].some(b=>String(b.getAttribute('onclick')).includes('setTheme')));if(!row||row.dataset.phase1Themes==='1')return;row.dataset.phase1Themes='1';row.classList.add('phase1-theme-row');const active=readTheme();row.innerHTML=Object.entries(themes).map(([id,v])=>`<button class="chip ${active===id?'active':''}" onclick="setTheme('${id}')"><span aria-hidden="true">${id==='emerald-glass'?'◈':id==='midnight-academic'?'◐':'◇'}</span> ${v.label}</button>`).join('')}
  function installCarousel(root){
    const currentPath=String(window.Router?.path||location.hash.replace(/^#\/?/,'').split('?')[0]||'dashboard');
    if(currentPath!=='dashboard'&&currentPath!=='home'&&currentPath!=='')return;
    const carousel=root.querySelector('.command-carousel');const track=carousel?.querySelector('#commandTrack')||document.getElementById('commandTrack');if(!carousel||!track||!track.isConnected)return;let slides=[...track.querySelectorAll('.command-slide')];const cards=[...track.querySelectorAll('.command-card,.command-tile,.p3-command-card-v3')];if(!cards.length)return;const pageSize=6;const expected=Array.from({length:Math.ceil(cards.length/pageSize)},(_,i)=>Math.min(pageSize,cards.length-i*pageSize));if(slides.length!==expected.length||slides.some((s,i)=>s.querySelectorAll('.command-card,.command-tile,.p3-command-card-v3').length!==expected[i])){track.innerHTML='';let offset=0;expected.forEach(size=>{const s=document.createElement('div');s.className='command-slide';cards.slice(offset,offset+size).forEach(c=>s.appendChild(c));track.appendChild(s);offset+=size})}
    slides=[...track.querySelectorAll('.command-slide')];const pageWidth=100/slides.length;track.style.width=`${slides.length*100}%`;slides.forEach(s=>{s.style.width=`${pageWidth}%`;s.style.flex=`0 0 ${pageWidth}%`});let page=Number(carousel.dataset.page||0);const host=carousel.parentElement||carousel;let dots=[...host.querySelectorAll('.command-dot')];if(dots.length<slides.length){const nav=document.createElement('div');nav.className='command-dots';nav.innerHTML=slides.map((_,i)=>`<button class="command-dot" aria-label="Show tools page ${i+1}"></button>`).join('');host.appendChild(nav)}
    const allDots=[...host.querySelectorAll('.command-dot')];const go=i=>{page=Math.max(0,Math.min(slides.length-1,Number(i)||0));carousel.dataset.page=String(page);track.style.transform=`translate3d(${-page*pageWidth}%,0,0)`;allDots.forEach((d,n)=>{d.classList.toggle('active',n===page);d.setAttribute('aria-selected',n===page?'true':'false')})};allDots.forEach((d,i)=>d.onclick=()=>go(i));window.goCommandPage=go;if(track.dataset.phase1Bound!=='1'){track.dataset.phase1Bound='1';let sx=0,sy=0,drag=false;carousel.addEventListener('pointerdown',e=>{drag=true;sx=e.clientX;sy=e.clientY;try{if(e.pointerId!=null&&carousel.setPointerCapture)carousel.setPointerCapture(e.pointerId)}catch(_){}});carousel.addEventListener('pointerup',e=>{if(!drag)return;drag=false;const dx=e.clientX-sx,dy=e.clientY-sy;if(Math.abs(dx)>42&&Math.abs(dx)>Math.abs(dy))go(page+(dx<0?1:-1))});carousel.addEventListener('pointercancel',()=>{drag=false});carousel.addEventListener('wheel',e=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&Math.abs(e.deltaX)>20){e.preventDefault();go(page+(e.deltaX>0?1:-1))}},{passive:false})}go(page)}
  function ensureSpecialTools(){ return; }
  function patchDashboard(){const app=document.getElementById('app');if(!app)return;themeControls();installCarousel(app);ensureSpecialTools(app)}
  let patchFrame=0;
  let patchRunning=false;
  function schedulePatch(){
    if(patchFrame)return;
    patchFrame=requestAnimationFrame(()=>{
      patchFrame=0;
      if(patchRunning)return;
      patchRunning=true;
      try{patchDashboard()}finally{patchRunning=false}
    });
  }
  const oldRender=window.render;
  if(typeof oldRender==='function')window.render=function(){const r=oldRender.apply(this,arguments);schedulePatch();return r};
  const app=document.getElementById('app');
  if(app)new MutationObserver(schedulePatch).observe(app,{childList:true,subtree:true});
  window.addEventListener('load',()=>schedulePatch(),{once:true});
})();
