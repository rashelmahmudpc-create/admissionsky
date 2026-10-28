// Dashboard single-authority regression; independent of the retired account system.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
let pass = 0, fail = 0;
const test = (name, ok) => { if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗', name); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');
const HEADERS = existsSync('_headers') ? readFileSync('_headers', 'utf8') : '';

test('obsolete dashboard injectors stay deleted and unloaded',
  !existsSync('phase3-intelligence.js') && !existsSync('daily-streak-card.js') && !existsSync('dashboard-greeting-3d.js') &&
  !/phase3-intelligence|daily-streak-card|dashboard-greeting-3d/.test(H + SW));

test('production code contains no superseded command-center markers', (() => {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'docs', 'AGENT_RESUME', 'uploads', 'admin'].includes(entry)) continue;
      const path = join(dir, entry);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (entry.endsWith('.js') || entry.endsWith('.html')) files.push(path);
    }
  };
  walk('.');
  return !files.some(file => /TODAY COMMAND CENTER|Your Command Center|Swipe to explore/.test(readFileSync(file, 'utf8')));
})());

test('HTML and service worker are no-cache controlled', HEADERS.includes('/sw.js') && HEADERS.includes('/index.html') && HEADERS.includes('Cache-Control: no-cache'));
test('dashboard and app-shell build markers are current',
  H.includes('dashboard-v2.js?v=dash2f18-chrome') && SW.includes('dashboard-v2.js?v=dash2f18-chrome') &&

  SW.includes("const BUILD_ID = 'v364-sky-goal'") && H.includes("const expectedSwVersion = 'v364-sky-goal'"));

test('dashboard-v2 renders without any account bootstrap', await (async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div><div id="navRoot"></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.Router = { path: 'dashboard' };
  w.CACHE = { examResults: [], mistakes: [], settings: { dailyTarget: 100, dashboardCards: {} }, dailyStats: [], questions: [], activityLogs: [], subjects: [], topics: [] };
  w.navigate = () => {};
  w.renderShell = html => { w.__shell = html; w.document.getElementById('app').innerHTML = html; };
  w.toast = () => {};
  const script = w.document.createElement('script'); script.textContent = DASH; w.document.body.appendChild(script);
  await new Promise(resolve => setTimeout(resolve, 30));
  try { w.renderDashboard?.(); } catch (_) {}
  const html = String(w.__shell || '') + w.document.getElementById('app').innerHTML;
  /* The design rides in the frame's srcdoc, so assert both the mounted frame and
   * the frame source; the shell itself must stay free of any account-bootstrap
   * prompt (the header avatar routes to Profile, not a login gate). */
  const src = String(w.document.querySelector('iframe.dv3-frame')?.getAttribute('srcdoc') || '');
  return html.includes('dv3-frame') && src.includes('id="greet"') && !/\blog ?in\b|sign ?in|লগইন|লগ ইন/i.test(html);
})());

test('inline application shell cannot emit a legacy dashboard marker', !/TODAY COMMAND CENTER|Your Command Center|Swipe to explore|data-p3-command/.test(H));
console.log(`\nLEGACY DASHBOARD GUARD: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
