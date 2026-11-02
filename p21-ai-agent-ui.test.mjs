// 🧩 PHASE 21 — AI AGENT UI (Sky)
// Locks the student-facing AI chat. The owner replaced the old chatv1 UI with
// the Sky design on 2026-10-15, so these guards describe Sky's real contract
// instead of the removed markup's private class names. Everything load-bearing
// is still pinned: the mount point, the live backend endpoints, the SSE parser,
// the guest header, the absence of any key or demo data, and the rule that the
// chat follows the APP's theme rather than owning its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const UI = existsSync('ai-agent-chat.js') ? readFileSync('ai-agent-chat.js', 'utf8') : '';
/* F2.1: Sky's stylesheet was extracted to sky-chat.css, so a CSS assertion
   must read both files — the rule it guards is unchanged, only its home is. */
const SKYCSS = existsSync('sky-chat.css') ? readFileSync('sky-chat.css', 'utf8') : '';
const V2 = readFileSync('dashboard-v2.js', 'utf8');

const t = (name, cond) => test(name, () => assert.ok(cond, name));

t('১. index.html-এ ai-রুট dispatch (renderAiAgentPage)', H.includes("if(p==='ai'){ if(window.renderAiAgentPage)"));
t('২. ai-agent-chat.js স্ক্রিপ্ট-ট্যাগ', H.includes('./ai-agent-chat.js?v=agent-f1-ui-skyv13'));
t('৩. ai-agent-chat.js ফাইল-বিদ্যমান + renderAiAgentPage-এক্সপোজ', existsSync('ai-agent-chat.js') && UI.includes('window.renderAiAgentPage = render'));
t('৪. NAV_TABS থেকে AI ট্যাব বাদ — AI এখন dashboard Command Center + সরাসরি /ai রুট', (H.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0].length > 0 && !(H.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0].includes("key:'ai'") && !H.includes('juju-floating') && H.includes("if(p==='ai'){ if(window.renderAiAgentPage)"));

/* ── Sky UI: the surfaces the owner asked for, by their real selectors ── */
t('৫. Sky v2 hero: speech bubble + animated avatar with live props (owner design 2026-10-15)', UI.includes('class="hero"') && UI.includes('id="hbig"') && UI.includes('id="say"') && ['p-lap', 'p-book', 'p-note', 'p-cup', 'p-mag', 'p-calc', 'p-ph'].every((c) => UI.includes(c)) && UI.includes("'capTip'") && !UI.includes('id="tryq"'));
t('৬. Composer: capsule + plus + mic/send/stop morph', UI.includes('class="comp"') && UI.includes('id="plusB"') && UI.includes('id="actB"') && UI.includes('ic(busy ? ') && UI.includes("'stop'") && UI.includes("'send'"));
t('৭. Bottom-sheet: attachment + Sky tools', UI.includes('id="sheet"') && UI.includes('T.attach') && UI.includes('T.tools') && UI.includes('id="camB"'));
t('৮. Drawer: new chat + search + session list + in-app nav', UI.includes('id="drawer"') && UI.includes('id="newD"') && UI.includes('id="hs"') && UI.includes('id="hl"') && UI.includes('data-go="question-bank"'));
t('৯. Voice-in: Web-Speech (উপলব্ধ-চেক + fallback)', (UI.includes('webkitSpeechRecognition') || UI.includes('SpeechRecognition')) && UI.includes('ভয়েস শোনা যায় না'));
t('১০. AI-msg: markdown body + copy/regen/👍 bar', UI.includes('function md(') && UI.includes('data-c="') && UI.includes('data-r="') && UI.includes('data-g="'));
t('১১. Live status panel (real request stages only) + streaming into the live node', UI.includes('class="proc run open"') && UI.includes('onStage: (label) => procStage(node, holder, label)') && !UI.includes('const FLOW') && !UI.includes('const PO') && UI.includes("node.querySelector('.bw')"));
t('১২. প্রতি-বার্তায় রেগেন (আগের প্রশ্ন আবার) + কপি', UI.includes('sessions[cur].msgs.splice(i, 1)') && UI.includes('navigator.clipboard.writeText'));
t('১৩. Guest identity + account-scoped store + error retry', UI.includes("'X-AH-Guest': guestId()") && UI.includes('aiSkyChat:v1') && UI.includes('T.offline') && UI.includes('T.failed'));
t('১৪. Mobile-first: safe-area ব্যবহার', (UI + SKYCSS).includes('safe-area-inset'));
t('১৫. কোনো API-key প্যাটার্ন নেই + কোনো demo/নকল উত্তর নেই', !/AIza[0-9A-Za-z_-]{30,}/.test(H + UI + V2) && !UI.includes('generativelanguage') && !UI.includes('elevenlabs.io') && !UI.includes('const R = {') && !UI.includes('মনে রাখার ট্রিক'));

/* ── The live backend contract must stay intact ── */
t('১৬. ক্লায়েন্ট-কোডে SSE-পার্স (data:/event:) + AbortController', UI.includes("startsWith('data:')") && UI.includes("startsWith('event:')") && UI.includes('AbortController'));
t('১৭. আসল এন্ডপয়েন্ট: /api/ai/chat (SSE) — কোনো নকল উত্তর নয়', UI.includes("fetch('/api/ai/chat'") && UI.includes('X-AH-Guest'));
t('১৮. স্ট্রিমে replace-event + মেটা (model/provider/intent) হ্যান্ডেল হয়', UI.includes("evt === 'replace'") && UI.includes('j.provider') && UI.includes('j.intent'));
t('১৯. থিম অ্যাপের নিজের ইঞ্জিন থেকে আসে — চ্যাট নিজের থিম বানায় না', UI.includes('window.AhAppearance') && UI.includes('ah:appearance') && UI.includes('data-sky-theme'));
t('২০. অ্যাপে ফেরার রাস্তা (nav ফিরে আসে + bottomnav আবার দেখায়)', UI.includes('function backHome()') && UI.includes("document.querySelector('.bottomnav')") && UI.includes("nb.style.display = ''"));
t('২১. M9 অ্যাকশন-ইঞ্জিন অটুট (প্রস্তাব→নিশ্চিতকরণ)', UI.includes('const ACT_ACTIONS = {') && UI.includes("'/api/ai/actions/propose'") && UI.includes("'/api/ai/actions/confirm'") && UI.includes('function msgHtml(m, idx) {'));
t('২২. p06 weak-topic কনট্র্যাক্ট অটুট', UI.includes('const learningProfile = ') && UI.includes('weakTopics: lp.weakTopics, subjects: lp.subjects'));
t('২৩. duplicate-turn গার্ড অটুট (একই টার্ন দুইবার নয়)', /const history = sessions\[cur\]\.msgs\.slice\(0, -1\)[\s\S]{0,300}?map\(\(m\) => \(\{ role: m\.role === 'user' \? 'user' : 'assistant', content: /.test(UI));

t('২৪. sw APP_SHELL-এ AI ফাইল', SW.includes('./ai-agent-chat.js?v=agent-f1-ui-skyv13') && SW.includes('dashboard-v2.js?v='));
