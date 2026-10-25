// P20-রিগ্রেশন — Vocabulary voice: same-origin /api/voice + generate-একবার → অফলাইন-ক্যাশ
// মালিক (২০২৬-০৯-০৭, স্ক্রিনশট): "vocabulary card এ voice শুনা যাচ্ছে না — click করলে একবার generate হলে
//   ২য় বার আর generate করতে হবে না, অফলাইনেও চলবে" (টোস্ট: "Voice generate হয়নি — বিল্ট-ইন voice চলছে")।
// কারণ: ① voice-worker-এর CORS-allowlist-এ pages.dev ছিল না (শুধু github.io+localhost) → pages.dev-পেজ-থেকে
//   সরাসরি-ডাকা ব্রাউজার-ব্লক ("Failed to fetch"); ② মালিক-নেটে *.workers.dev ব্লক (P15-প্রমাণ);
//   ③ hub-অ্যাপের পুরনো এন্ডপয়েন্ট মৃত (DNS-নেই); ④ পুরনো-কপিতে অন্য-এন্ডপয়েন্ট-সেভ-থাকতে-পারে।
// ফিক্স: _worker.js /api/voice → voice-worker (same-origin); ক্লায়েন্ট-ডিফল্ট same-origin + workers.dev
//   মাইগ্রেশন + স্পষ্ট-এরর; voice-worker-allowlist-এ pages.dev; hub-এ লাইভ-এন্ডপয়েন্ট।
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const WK = readFileSync('_worker.js', 'utf8');
const VE = readFileSync('vocabulary-elevenlabs.js', 'utf8');
const VW = readFileSync('voice-worker.js', 'utf8');
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/* ── ১. same-origin-পথ ── */
t('১. _worker.js: /api/voice → voice-worker, /api/voice/agent|login|session → মূল-worker (অটুট)', WK.includes("url.pathname.startsWith('/api/voice') ? VOICE_ORIGIN : ORIGIN") && WK.includes("const VOICE_ORIGIN = 'https://admission-voice.admissionhub.workers.dev'") && WK.includes('AGENT_API.test(url.pathname) ? ORIGIN'));
t('২. ক্লায়েন্ট-ডিফল্ট same-origin ("" → /api/voice) + voiceOff-পৃথক', VE.includes("const DEFAULT_ENDPOINT = '';") && VE.includes('fetch(proxyUrl + \'/api/voice\',') && VE.includes('const configured = () => !voiceOff;'));
t('৩. মাইগ্রেশন: পুরনো workers.dev সেভ-ভ্যালু → same-origin', VE.includes("if (saved && saved.includes('.workers.dev')) saved = '';"));
t('৪. voice-worker-allowlist-এ pages.dev (CORS-ফাঁক-বন্ধ)', VW.includes('(admissionsky|admissionhub)\\.pages\\.dev$/.test(origin)') && VW.includes('P20 (v204)') && !VW.includes("([a-z0-9-]+\\.)?pages\\.dev$/"));
t('৫. Pages proxy preserves method, headers and request body', WK.includes('new Headers(request.headers)') && WK.includes('method: request.method') && WK.includes('init.body = request.body'));

/* ── ২. ভার্সন-অখণ্ডতা v204 ── */

t('৬. el-voice-v111 stays deferred outside the lean current app shell', H.includes('vocabulary-elevenlabs.js?v=el-voice-v111') && !SW.includes("'./vocabulary-elevenlabs.js?v=el-voice-v111'") && SW.includes("const BUILD_ID = 'v364-sky-goal'") && H.includes("const expectedSwVersion = 'v364-sky-goal'") && H.includes("const expectedSwVersion = 'v364-sky-goal'") && H.includes("const cur = 'admission-hub-shell-v364-sky-goal'"));

/* ── ৩. রানটাইম: এক-ক্লিক → generate+সেভ → ২য়-ক্লিক-নেট-নয় → অফলাইনে-বাজে ── */
t('৭. রানটাইম: ১ম-ক্লিক generate+ক্যাশ ("generated") → ২য়-ক্লিক ক্যাশ থেকে ("cache", নেট-০) → অফলাইনেও বাজে', (async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.toast = () => {};
  w.Audio = undefined; /* jsdom-এ নেই — fallback-পথও-সহ্য */
  let fetchCount = 0;
  w.fetch = (url, opts = {}) => {
    fetchCount++;
    const blob = new w.Blob([new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])], { type: 'audio/mpeg' });
    return Promise.resolve({ ok: true, status: 200, blob: async () => blob, json: async () => ({}) });
  };
  const load = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  load(VE);
  await new Promise(r => setTimeout(r, 100));
  const api = w.VocabularyElevenLabs;
  if (!api) return false;
  const r1 = await api.speakWord('Ephemeral', null);
  await new Promise(r => setTimeout(r, 50));
  const f1 = fetchCount;
  const r2 = await api.speakWord('Ephemeral', null); /* ২য়-ক্লিক — নেট-না-চাই */
  const f2 = fetchCount;
  /* অফলাইন-সিমুলেশন: নতুন-word (ক্যাশ-নেই) → নেট-না; আগের-word → ক্যাশ */
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  const rOff = await api.speakWord('Ephemeral', null);
  return r1.startsWith('generated') && f1 === 1 && r2.startsWith('cache') && f2 === 1 && rOff.startsWith('cache');
})());

console.log(`\nP20-VOICE-SAMEORIGIN: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
