// P16-রিগ্রেশন — একক-ড্যাশবোর্ড (মালিক 😡: "একসাথে ২টি ড্যাশবোর্ড — পুরোনোটা সম্পূর্ণ ডিলিট করো")
// কারণ: dv2-র renderV2 আগে `previous()` চালাত (phase5-intel নিতে) — পুরনো renderDashboard-চেইন
// (phase5/study-hub/vocab-master/greeting/phase345-র্যাপার-সহ) সেই রেন্ডারে পুরনো ড্যাশবোর্ড DOM-এ ফেলে দিত
// → স্ক্রল করে নিচে নামলে আবার দ্বিতীয় (পুরনো) ড্যাশবোর্ড। ফিক্স: renderV2-এ previous() সম্পূর্ণ বাদ +
// dv2Cleanup() (একাধিক .page-সরানো + পুরনো-মার্কার-শূন্যকরণ)।
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/* ── ১. স্ট্যাটিক ── */
t('১. renderV2-এ previous() / intel-ক্যাপচার সম্পূর্ণ-বিলুপ্ত', !V2.includes('intel = el.outerHTML') && !V2.includes('data-dv2-phase5') && !/previous\(\);[\s\S]{0,400}querySelector\('#app \[data-phase5-dashboard\]'\)/.test(V2));
t('২. dv2Cleanup বিদ্যমান (একাধিক .page-সরানো)', V2.includes('function dv2Cleanup') && V2.includes("const pages = Array.from(app.querySelectorAll('.page'))") && V2.includes('if (p !== keep) p.remove();'));
t('৩. পুরনো-ড্যাশ-মার্কার-শূন্যকরণ-তালিকা (phase5/phase34/comparison/quicklinks/gk/old-dash)', V2.includes('[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison],[data-phase5-quicklinks],.daily-gk-teaser,.p3-dashboard-v3,.dashboard-v2,.p3-dashboard'));
t('৪. cleanup রেন্ডার-শেষে-ও-ফলব্যাক-পথে-উভয়ই (dv2Cleanup ২-কল)', (V2.match(/dv2Cleanup\(\);/g) || []).length >= 2);

t('৫. ভার্সন: dashboard-v2.js ?v=dash2f10-main-ai (index+sw) + current BUILD_ID', H.includes('dashboard-v2.js?v=dash2f18-chrome') && SW.includes("'./dashboard-v2.js?v=dash2f18-chrome'") && SW.includes("const BUILD_ID = 'v364-sky-goal'") && H.includes("const expectedSwVersion = 'v364-sky-goal'"));

/* ── ২. রানটাইম: পুরনো-রেন্ডার-চেইন-হুবহু + append-mode-renderShell → এক-পেজ ── */
t('৬. রানটাইম: previous-চেইন-দ্বৈত-বানালেও dv2-র-পর #app-এ ঠিক-একটি .page + শুধু dv2', (async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"><main class="app-loading">x</main></div><div id="navRoot"></div><div id="modalRoot"></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.Router = { path: 'dashboard' };
  w.navigate = (r) => { w.Router.path = String(r); };
  w.toast = () => {};
  /* renderShell-মক: প্রতিটি কল #app-এ নতুন .page-append (সবচেয়ে-খারাপ-কেস — আসল-রেপ্লেস-থেকেও-নিষ্ঠুর) */
  w.renderShell = (inner, opts) => {
    const app = w.document.getElementById('app');
    if (!app) return;
    const page = w.document.createElement('div');
    page.className = 'page';
    page.innerHTML = String(inner);
    app.appendChild(page);
  };
  /* পুরনো-ড্যাশবোর্ড-চেইন: view-এ-পুরনো+phase5-মার্কার (dv2-লোড-আগের-মোড়ানো-র্যাপার-সিমুলেশন) */
  w.renderDashboard = function oldDash() {
    /* এই-কল-একাধিক-বার-হলে-একাধিক-পুরনো-পেজ-জমা-হবে — dv2-কে-পরিষ্কার-করতে-হবে */
    w.renderShell('<div class="h2">OLD DASH</div><div class="fade-in"><b>old-main</b></div>', {});
    const app = w.document.getElementById('app');
    const last = app.querySelector('.page:last-child');
    if (last && !last.querySelector('[data-phase5-dashboard]')) last.insertAdjacentHTML('beforeend', '<div data-phase5-dashboard>INTEL</div><div class="daily-gk-teaser">GK</div>');
  };
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  run(V2);
  /* ① ইউজার-স্ক্রল-করা-দৃশ্য: পুরনো-চেইন-আগে-চালাও (যদি-অন্য-কেউ-ডাকত) */
  w.renderDashboard(); /* ← পুরনো-রেফ (dv2-আগে-ধরা) */
  w.renderDashboard(); /* ← পুরনো-রেফ-আবার */
  /* ② dv2-রেন্ডার */
  w.renderDashboard();
  await new Promise(r => setTimeout(r, 50));
  const app = w.document.getElementById('app');
  const pages = app.querySelectorAll('.page');
  const keep = pages.length ? pages[pages.length - 1] : null;
  const ok =
    pages.length === 1 &&
    keep && keep.querySelector('.dv2-root') &&
    !app.innerHTML.includes('OLD DASH') &&
    app.querySelectorAll('[data-phase5-dashboard]').length === 0 &&
    app.querySelectorAll('.daily-gk-teaser').length === 0;
  return ok;
})());

t('৭. রানটাইম: dv2-র-পর-আরও-এক-রেন্ডার-কলেও (নেভ-ফিরে-আসা) এক-পেজ-অটুট', (async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"><main class="app-loading">x</main></div><div id="navRoot"></div><div id="modalRoot"></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.Router = { path: 'dashboard' };
  w.navigate = (r) => { w.Router.path = String(r); };
  w.toast = () => {};
  w.renderShell = (inner, opts) => { const app = w.document.getElementById('app'); if (!app) return; const page = w.document.createElement('div'); page.className = 'page'; page.innerHTML = String(inner); app.appendChild(page); };
  w.renderDashboard = function () { w.renderShell('<div class="h2">OLD DASH</div>', {}); };
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  run(V2);
  w.renderDashboard();
  w.renderDashboard();
  w.renderDashboard();
  await new Promise(r => setTimeout(r, 50));
  const app = w.document.getElementById('app');
  const pages = app.querySelectorAll('.page');
  return pages.length === 1 && pages[0].querySelector('.dv2-root') && !app.innerHTML.includes('OLD DASH');
})());

console.log(`\nP16-DASHBOARD-SINGLE: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
