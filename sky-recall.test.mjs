// 🔔 Sky recall (owner plan step 2): when the chat opens, Sky reminds the
// student of recent mistakes and their weak topic by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRecall, sanitizeRecent, whenWord, isSmallTalkTopic } from './sky-recall.mjs';
import { makeMemory, upsertMemory, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';
import { agentRecall } from './ai-agent.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 18, 6, 0, 0);
const UID = 'account-sidratul';
const weak = (v, uid = UID, ts = NOW - DAY) => makeMemory({ kind: KIND.STUDIES, key: 'weak-topic', value: v, source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'r', ts }, uid);
const last = (v, ts) => makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: v, source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়', ts }, UID);

test('nothing known → null (the normal greeting stays)', () => {
  assert.equal(buildRecall({ records: [], stats: { exams: 0 }, recent: null, now: NOW }), null);
  assert.equal(buildRecall({}), null);
});

test('owner example: no exam yet + stated সমাসে → exact line and a quiz button', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: { exams: 0 }, now: NOW });
  assert.equal(r.line, 'তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে সমাসে দুর্বল, আজ সমাস দিয়ে শুরু করি?');
  assert.equal(r.button.prompt, 'সমাস থেকে ৫টা প্রশ্নে কুইজ দাও');
  assert.deepEqual(r.kinds, ['weak-stated']);
  assert.doesNotMatch(r.line, /[*_#`<>]/, 'plain text, no Markdown/HTML');
});

test('recent mistakes come first, weak topic second; button is for the mistakes', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: { exams: 0 }, recent: { mistakes: 5, since: NOW - DAY - 3600e3 }, now: NOW });
  assert.match(r.line, /^গতকাল থেকে ৫টা প্রশ্নে ভুল হয়েছে/);
  assert.match(r.line, /আগে বলেছিলে সমাসে দুর্বল/);
  assert.doesNotMatch(r.line, /পরীক্ষা দাওনি/);
  assert.deepEqual(r.kinds, ['mistakes', 'weak-stated']);
  assert.match(r.button.prompt, /ভুল/);
});

test('a measured weak topic beats the stated one and shows its real accuracy', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: { exams: 3, weakTopics: [{ name: 'ইংরেজি', accuracy: 40 }, { name: 'গণিত', accuracy: 30 }] }, now: NOW });
  assert.match(r.line, /গণিত-এ সঠিকতা এখন ৩০%/);
  assert.doesNotMatch(r.line, /সমাস/);
  assert.deepEqual(r.kinds, ['weak-measured']);
});

test('last topic only when nothing else, within 7 days, never hi/thanks', () => {
  const fresh = buildRecall({ records: [last('নিউটনের সূত্র', NOW - DAY)], now: NOW });
  assert.match(fresh.line, /গতকাল আমরা “নিউটনের সূত্র” নিয়ে কথা বলছিলাম/);
  assert.equal(buildRecall({ records: [last('নিউটনের সূত্র', NOW - 9 * DAY)], now: NOW }), null);
  for (const g of ['হাই', 'ধন্যবাদ', 'Thanks!', 'ok', 'আসসালামু আলাইকুম']) {
    assert.ok(isSmallTalkTopic(g), g);
    assert.equal(buildRecall({ records: [last(g, NOW - DAY)], now: NOW }), null, g);
  }
  assert.equal(isSmallTalkTopic('সমাস কাকে বলে'), false);
});

test('client numbers are clamped; junk is ignored', () => {
  assert.deepEqual(sanitizeRecent({ mistakes: 1e9, since: 'x' }), { mistakes: 999, since: 0 });
  assert.equal(sanitizeRecent('x'), null);
  assert.equal(whenWord(NOW, NOW), 'আজ');
  assert.equal(whenWord(NOW - 3 * DAY, NOW), '৩ দিন আগে');
});

function fakeEnv(store) {
  return { PUB_KV: { get: async (k) => (k in store ? store[k] : null), put: async () => { throw new Error('recall must not write'); }, delete: async () => {} } };
}

test('endpoint: a student sees only their own memory', async () => {
  const store = { ['mem:' + MEMORY_VERSION + ':account-a']: JSON.stringify(upsertMemory([], weak('সমাসে', 'account-a'), 'account-a')) };
  const a = await (await agentRecall(fakeEnv(store), 'account-a', { stats: { exams: 0 } })).json();
  assert.match(a.recall.line, /সমাসে/);
  const b = await (await agentRecall(fakeEnv(store), 'account-b', { stats: { exams: 0 } })).json();
  assert.equal(b.recall, null);
  /* even if account-a's memory were copied under b's key, the owner check refuses it */
  const stolen = { ['mem:' + MEMORY_VERSION + ':account-b']: store['mem:' + MEMORY_VERSION + ':account-a'] };
  const c = await (await agentRecall(fakeEnv(stolen), 'account-b', { stats: { exams: 0 } })).json();
  assert.equal(c.recall, null);
});

test('endpoint: guests get nothing; the kill switch turns it off', async () => {
  const g = await (await agentRecall(fakeEnv({}), 'guest-1', {})).json();
  assert.equal(g.recall, null);
  const store = { 'sky:recall': 'off', ['mem:' + MEMORY_VERSION + ':account-a']: JSON.stringify([weak('সমাসে', 'account-a')]) };
  const o = await (await agentRecall(fakeEnv(store), 'account-a', {})).json();
  assert.equal(o.recall, null);
  assert.equal(o.off, true);
});

test('wiring: 401 route, timeout, greet fallback, en skipped, textContent only', () => {
  const pub = readFileSync(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.ok(pub.includes("path === '/api/ai/recall' && request.method === 'POST'"));
  assert.ok(pub.includes("if (!identity.authenticated) return json({ error: 'sign_in_required', recall: null }, 401);"));
  const ui = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("fetch('/api/ai/recall'"));
  assert.ok(ui.includes("ctrl.abort(); } catch (_) {} }, 2500);"));
  assert.ok(ui.includes("if (lang === 'en' || !accountScope"));
  assert.ok(ui.includes("if (!rc) { say(greet, 4200); return; }"));
  assert.ok(ui.includes("el.textContent = String(btn.label"));
  assert.ok(ui.includes("send(String(btn.prompt)"));
  assert.ok(ui.includes("return { mistakes: n, since: since };"), 'only a count leaves the phone');
  const fn = ui.slice(ui.indexOf('function showRecall'), ui.indexOf('function resetHero'));
  assert.doesNotMatch(fn, /innerHTML/);
});
