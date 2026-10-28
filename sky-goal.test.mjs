// 🎯 Sky goal (owner plan step 3): Sky keeps the admission goal in mind and
// shapes advice around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isGoalQuestion, resolveGoal, renderGoalContext } from './sky-goal.mjs';
import { extractMemoryCandidates, makeMemory, upsertMemory, statedGoal, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';
import { buildRecall } from './sky-recall.mjs';
import { agentRecall } from './ai-agent.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 18, 6, 0, 0);
const goalRec = (v, uid = 'account-a', ts = NOW - DAY) => makeMemory({ kind: KIND.STUDIES, key: 'goal', value: v, source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'r', ts }, uid);
const weakRec = (v, uid = 'account-a') => makeMemory({ kind: KIND.STUDIES, key: 'weak-topic', value: v, source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'r', ts: NOW - DAY }, uid);
const keys = (s) => extractMemoryCandidates(s).map((c) => c.key + ':' + c.value);
const DU = { targets: [{ name: 'ঢাকা বিশ্ববিদ্যালয়', unit: 'ক ইউনিট', year: '2026-27' }] };

test('a goal said in chat is remembered; asking about it never overwrites it', () => {
  assert.deepEqual(keys('আমার লক্ষ্য ঢাবি ক ইউনিট'), ['goal:ঢাবি ক ইউনিট']);
  assert.deepEqual(keys('আমার টার্গেট হলো বুয়েট'), ['goal:বুয়েট']);
  assert.deepEqual(keys('আমি ঢাবিতে চান্স পেতে চাই'), ['goal:ঢাবি']);
  assert.deepEqual(keys('আমার লক্ষ্য কী?'), []);
  assert.deepEqual(keys('লক্ষ্য পূরণে কী পড়ব'), []);
});

test('clauses stay apart: goal and weak topic from one sentence', () => {
  assert.deepEqual(keys('আমার লক্ষ্য ঢাকা বিশ্ববিদ্যালয়ে পড়া, সমাসে দুর্বল').sort(), ['goal:ঢাকা বিশ্ববিদ্যালয়ে পড়া', 'weak-topic:সমাসে']);
  assert.deepEqual(keys('আমি সমাসে দুর্বল'), ['weak-topic:সমাসে']);
  assert.deepEqual(keys('আমি কোন বিষয়ে দুর্বল?'), []);
});

test('advice questions are recognised; plain study and essay questions are not', () => {
  for (const q of ['ঢাবি ক ইউনিটের জন্য কীভাবে প্রস্তুতি নেব', 'মেডিকেল ভর্তি পরীক্ষার জন্য কী পড়ব', 'আমার লক্ষ্য অনুযায়ী আজকের পড়ার প্ল্যান দাও', 'আজকের রুটিন বানিয়ে দাও']) assert.ok(isGoalQuestion(q), q);
  for (const q of ['সমাস কী', 'SI ইউনিট কী', 'জীবনের লক্ষ্য রচনা লেখো', 'হাই']) assert.equal(isGoalQuestion(q), false, q);
});

test('profile target beats the goal said in chat; chat goal is the fallback', () => {
  const recs = [goalRec('বুয়েট')];
  assert.equal(resolveGoal({ profile: DU, records: recs }).label, 'ঢাকা বিশ্ববিদ্যালয় ক ইউনিট');
  assert.equal(resolveGoal({ profile: DU, records: recs }).source, 'profile');
  const chat = resolveGoal({ profile: null, records: recs });
  assert.equal(chat.label, 'বুয়েট');
  assert.equal(chat.source, 'chat');
  assert.equal(resolveGoal({}), null);
  assert.equal(statedGoal(upsertMemory([], goalRec('ঢাবি ক ইউনিট'), 'account-a')), 'ঢাবি ক ইউনিট');
});

test('prompt block names the goal, adds weak topics, never promises a seat', () => {
  const b = renderGoalContext(resolveGoal({ profile: DU }), { stated: ['সমাসে'] });
  assert.match(b, /ঢাকা বিশ্ববিদ্যালয় ক ইউনিট \(2026-27\)/);
  assert.match(b, /তোমার লক্ষ্য ঢাকা বিশ্ববিদ্যালয় ক ইউনিট, তাই/);
  assert.match(b, /weak in: সমাসে/);
  assert.match(b, /Never promise a seat/);
  const m = renderGoalContext(resolveGoal({ profile: DU }), { weakTopics: [{ name: 'গণিত', accuracy: 30 }], stated: ['সমাসে'] });
  assert.match(m, /Measured weak topics: গণিত 30%/);
  assert.doesNotMatch(m, /সমাসে/);
});

test('unknown goal: Sky asks once, then never again in that chat', () => {
  assert.match(renderGoalContext(null, {}), /কোন বিশ্ববিদ্যালয়\/ইউনিটে ভর্তি হতে চাও/);
  const again = renderGoalContext(null, { askedBefore: true });
  assert.doesNotMatch(again, /ভর্তি হতে চাও/);
  assert.match(again, /do not ask again/);
});

test('chat-open reminder uses the goal; without a goal the step-2 line is unchanged', () => {
  const g = { label: 'ঢাকা বিশ্ববিদ্যালয় ক ইউনিট' };
  const r = buildRecall({ records: [weakRec('সমাসে')], stats: { exams: 0 }, goal: g, now: NOW });
  assert.equal(r.line, 'তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে সমাসে দুর্বল, ঢাকা বিশ্ববিদ্যালয় ক ইউনিট-এর প্রস্তুতিতে আজ সমাস দিয়ে শুরু করি?');
  const plain = buildRecall({ records: [weakRec('সমাসে')], stats: { exams: 0 }, now: NOW });
  assert.equal(plain.line, 'তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে সমাসে দুর্বল, আজ সমাস দিয়ে শুরু করি?');
  const only = buildRecall({ records: [], stats: { exams: 0 }, goal: g, now: NOW });
  assert.match(only.line, /^তোমার লক্ষ্য ঢাকা বিশ্ববিদ্যালয় ক ইউনিট, /);
  assert.equal(only.button.prompt, 'আমার ভর্তির লক্ষ্য অনুযায়ী আজকের পড়ার প্ল্যান দাও');
  assert.equal(buildRecall({ records: [], stats: {}, now: NOW }), null);
});

function fakeEnv(store) {
  return { PUB_KV: { get: async (k) => (k in store ? store[k] : null), put: async () => { throw new Error('no write'); }, delete: async () => {} } };
}
test('endpoint: goal comes from the caller\'s own profile/memory only', async () => {
  const store = { ['mem:' + MEMORY_VERSION + ':account-a']: JSON.stringify(upsertMemory([], goalRec('বুয়েট'), 'account-a')) };
  const a = await (await agentRecall(fakeEnv(store), 'account-a', { stats: {} })).json();
  assert.match(a.recall.line, /তোমার লক্ষ্য বুয়েট/);
  const b = await (await agentRecall(fakeEnv(store), 'account-b', { stats: {} })).json();
  assert.equal(b.recall, null);
  const p = await (await agentRecall(fakeEnv({}), 'account-b', { stats: {}, profile: DU })).json();
  assert.match(p.recall.line, /ঢাকা বিশ্ববিদ্যালয় ক ইউনিট/);
  const g = await (await agentRecall(fakeEnv({}), 'guest-x', { profile: DU })).json();
  assert.equal(g.recall, null);
});

test('wiring: goal block only for signed-in advice questions, never cached, profile sent to recall', () => {
  const src = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
  assert.ok(src.includes("sendCtx.uid.startsWith('account-') && isGoalQuestion(toolText)"));
  assert.ok(src.includes('!toolCtxUsed && !goalUsed && !appFeatureHit;'), 'a goal-shaped answer is personal: never cached or shared');
  assert.ok(src.includes('resolveGoal({ profile: sanitizeProfileContext(b.profile), records })'));
  const ui = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('recent: recentMistakes(), profile: profilePayload() })'));
});
