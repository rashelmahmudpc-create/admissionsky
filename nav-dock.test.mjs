// nav-dock: every screen that shows a bottom bar draws the Dashboard's dock (owner 2026-10-17)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(new URL('./nav-dock.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('./dashboard-v2.js', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div><div id="navRoot"></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionsky.pages.dev/' });
  const w = dom.window;
  w.__calls = [];
  w.bottomNavHtml = () => '<div class="bottomnav">OLD</div>';
  w.AdmissionNavigation = { openTab: (k) => w.__calls.push(['tab', k]) };
  w.navigate = (k) => w.__calls.push(['go', k]);
  w.eval(SRC);
  return w;
}

test('index.html loads nav-dock.js right after phase12-ui.js (which drew the old bar)', () => {
  const a = HTML.indexOf('src="phase12-ui.js');
  const b = HTML.indexOf('src="nav-dock.js');
  assert.ok(a > 0 && b > a, 'nav-dock.js must come after phase12-ui.js');
  assert.ok(!/bottomNavHtml\s*=/.test(HTML.slice(b)), 'nothing after nav-dock may replace bottomNavHtml');
});

test('the bar is the Dashboard dock: Home, Bank, AI orb, Exam, Profile', () => {
  const w = boot();
  const html = w.bottomNavHtml('exam');
  assert.doesNotMatch(html, /OLD/);
  const d = w.document; d.getElementById('navRoot').innerHTML = html;
  const host = d.querySelector('#navRoot .bottomnav.ahd-host');
  assert.ok(host, 'keeps the .bottomnav hook (AI chat hides/shows it)');
  const labels = [...d.querySelectorAll('.ahd-nav > button.ahd-tab, .ahd-nav .ahd-slot .ahd-ailabel')].map((n) => n.textContent.trim());
  assert.deepEqual(labels, ['Home', 'Bank', 'AI', 'Exam', 'Profile']);
  assert.ok(d.querySelector('.ahd-nav > .ahd-slot > button.ahd-ai'), 'AI orb sits in the middle slot');
  const on = d.querySelectorAll('.ahd-tab.on');
  assert.equal(on.length, 1);
  assert.equal(on[0].getAttribute('data-nav-tab'), 'exam');
  assert.equal(on[0].getAttribute('aria-current'), 'page');
  assert.equal(d.querySelector('.ahd-pill').getAttribute('data-to'), '3');
  assert.ok(d.getElementById('ah-nav-dock-style'), 'dock styles are injected');
});

test('a screen with no matching tab shows no highlighted tab', () => {
  const w = boot();
  const d = w.document; d.getElementById('navRoot').innerHTML = w.bottomNavHtml('');
  assert.equal(d.querySelectorAll('.ahd-tab.on').length, 0);
  assert.ok(d.querySelector('.ahd-pill.ahd-none'));
});

test('taps use the same routes as the Dashboard dock', () => {
  const w = boot();
  const d = w.document; d.getElementById('navRoot').innerHTML = w.bottomNavHtml('question-bank');
  for (const k of ['dashboard', 'question-bank', 'exam', 'my-profile']) d.querySelector(`.ahd-tab[data-nav-tab="${k}"]`).click();
  d.querySelector('.ahd-ai').click();
  assert.deepEqual(w.__calls, [['tab', 'dashboard'], ['tab', 'question-bank'], ['tab', 'exam'], ['tab', 'my-profile'], ['go', 'ai']]);
  const dash = DASH.slice(DASH.indexOf('const ACTIONS'));
  assert.match(dash, /'nav\.bank': \(\) => tab\('question-bank'\)/);
  assert.match(dash, /'nav\.ai': \(\) => go\('ai'\)/);
  assert.match(dash, /'nav\.exam': \(\) => tab\('exam'\)/);
  assert.match(dash, /'nav\.profile': \(\) => tab\('my-profile'\)/);
});

test('dock art and size match the Dashboard frame exactly (drift guard)', () => {
  for (const frag of [
    'M9 22 24 9l15 13v17a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z',
    'M31.5 11.5l9.5-2.6 6 31.6-9.5 2.6z',
    'M29.4 35l2.6 2.6 4.8-5.2',
    'M7 43c1.4-9.5 8-14 17-14s15.6 4.5 17 14z',
    'M22 7l4.2 11.3L37.5 22.5 26.2 26.7 22 38l-4.2-11.3L6.5 22.5l11.3-4.2z',
    'width:min(440px,calc(100% - 32px))',
    'height:70px;border-radius:30px',
    'top:3px;transform:translateX(-50%);width:40px;height:40px',
    'conic-gradient(from 0deg,#6C95FF,#B07BFF,#FF7CC8,#FFC857,#6C95FF)'
  ]) {
    assert.ok(DASH.includes(frag), 'dashboard frame has: ' + frag);
    assert.ok(SRC.includes(frag), 'nav-dock has: ' + frag);
  }
});

test('Profile V2 frame ends above the dock, not behind it', () => {
  assert.ok(SRC.includes('body.ahd-on iframe.pv2-frame{height:calc(100dvh - 112px - var(--safe-b,0px))!important}'));
});

test('screens that hide the bar stay hidden (renderShell decides, dock adds nothing)', () => {
  assert.match(HTML, /navRoot\.innerHTML=showNav \? bottomNavHtml\(activeTab\) : ''/);
});

test('AI chat stays full screen: no dock and no dock padding there (owner 2026-10-17)', () => {
  assert.ok(SRC.includes("'html.ai-chat-open body #navRoot .bottomnav.ahd-host{display:none!important}'"), 'dock hidden on the AI screen');
  assert.ok(SRC.includes("'html:not(.ai-chat-open) body #app:not(.no-nav){padding-bottom:calc(112px + var(--safe-b,0px))!important}'"), 'dock padding skipped on the AI screen');
  assert.ok(!SRC.includes("'html body #app:not(.no-nav){padding-bottom"), 'old unconditional padding rule is gone');
  assert.ok(HTML.includes('src="nav-dock.js?v=dock-v2-20261101-inline"'), 'cache-busted script tag');
});
