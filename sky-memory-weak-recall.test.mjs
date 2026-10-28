// 🧠 Sky memory fix (2026-10-18): a weak topic the student STATED in chat must be
// used on the FIRST answer to "আমার দুর্বলতা কী?", even with an empty exam record.
// Bug: Sky first said "তুমি কোনো পরীক্ষা দাওনি, তাই কোনো দুর্বলতার তথ্য নেই" and only
// remembered "সমাস" after the student said "মনে করে দেখো".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMemory, upsertMemory, parseMemory, renderMemory, extractMemoryCandidates, statedWeakTopics, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';
import { analyzeWeakTopics, renderSimpleAnswer, renderToolContext, planServerTools, isSimplePlan, simpleToolResponse, topicBase } from './sky-tools.mjs';

const SRC = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
const UID = 'account-sidratul';

function storedFrom(text, uid = UID) {
  let list = [];
  for (const c of extractMemoryCandidates(text)) {
    const r = makeMemory(c, uid);
    if (r) list = upsertMemory(list, r, uid);
  }
  return list;
}

test('the student saying "আমি সমাসে দুর্বল" stores a weak-topic memory', () => {
  const list = storedFrom('আমি সমাসে দুর্বল');
  assert.deepEqual(statedWeakTopics(list), ['সমাসে']);
});

test('asking about a weakness never overwrites the stated weak topic', () => {
  let list = storedFrom('আমি সমাসে দুর্বল');
  for (const q of ['আমি কোন বিষয়ে দুর্বল?', 'আমার দুর্বলতা কী?', 'আমি কোথায় দুর্বল?', 'আমি কি সমাসে দুর্বল?']) {
    for (const c of extractMemoryCandidates(q)) { const r = makeMemory(c, UID); if (r) list = upsertMemory(list, r, UID); }
  }
  assert.deepEqual(statedWeakTopics(list), ['সমাসে']);
});

test('a statement plus a question still stores the statement', () => {
  assert.deepEqual(statedWeakTopics(storedFrom('আমি সমাসে দুর্বল, কী করবো?')), ['সমাসে']);
});

test('REGRESSION: empty exam record + stated weak topic → first (tool-only) answer names it', async () => {
  const stats = { exams: 0 };
  for (const q of ['আমার দুর্বলতা কী?', 'আমার দুর্বল বিষয় কী?', 'আমি কোথায় দুর্বল?', 'আমি কোন বিষয়ে দুর্বল?']) {
    const plan = planServerTools(q, {});
    assert.ok(plan.some(p => p.name === 'analyze_weak_topics'), 'weak question must plan the weak tool: ' + q);
    assert.ok(isSimplePlan(plan, q));
    const res = await simpleToolResponse(plan, false, { stats, statedWeak: ['সমাসে'] });
    const body = await res.json();
    assert.match(body.text, /এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে \*\*সমাসে\*\* দুর্বল/);
    assert.match(body.text, /আজ \*\*সমাস\*\* দিয়ে শুরু করি\?/);
    assert.doesNotMatch(body.text, /বলা যাচ্ছে না|তথ্য নেই/);
  }
});

test('no exam and nothing stated → the honest "not enough data" answer is unchanged', () => {
  const text = renderSimpleAnswer([{ name: 'analyze_weak_topics', ...analyzeWeakTopics({ exams: 0 }, []) }]);
  assert.match(text, /দুর্বল টপিক বলা যাচ্ছে না/);
});

test('measured weak topics still lead; the stated one is added, not replacing them', () => {
  const r = { name: 'analyze_weak_topics', ...analyzeWeakTopics({ exams: 3, weakTopics: [{ name: 'ইংরেজি', accuracy: 40, attempts: 9 }] }, ['সমাসে']) };
  const text = renderSimpleAnswer([r]);
  assert.match(text, /ইংরেজি, সঠিকতা/);
  assert.match(text, /আগে নিজেও বলেছিলে \*\*সমাসে\*\* দুর্বল/);
});

test('model path: tool context and memory both tell the model about the stated weakness', () => {
  const ctx = renderToolContext([{ name: 'analyze_weak_topics', ...analyzeWeakTopics({ exams: 0 }, ['সমাসে']) }]);
  assert.match(ctx, /no measured weak topic yet/);
  assert.match(ctx, /weak in: সমাসে/);
  const mem = renderMemory(storedFrom('আমি সমাসে দুর্বল'), MEMORY_VERSION);
  assert.match(mem, /দুর্বল বিষয় \(শিক্ষার্থী নিজে বলেছে\): সমাসে/);
  assert.match(mem, /পরীক্ষার ফল না থাকলেও/);
});

test('memory without a weak topic adds no weakness rule', () => {
  const r = makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: 'নিউটনের সূত্র', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়' }, UID);
  const mem = renderMemory([r], MEMORY_VERSION);
  assert.match(mem, /নিউটনের সূত্র/);
  assert.doesNotMatch(mem, /পরীক্ষার ফল না থাকলেও/);
});

test('one student never sees another student\'s stated weak topic', () => {
  const raw = JSON.stringify(storedFrom('আমি সমাসে দুর্বল', 'account-a'));
  assert.deepEqual(statedWeakTopics(parseMemory(raw, 'account-b')), []);
  assert.deepEqual(statedWeakTopics(parseMemory(raw, 'account-a')), ['সমাসে']);
});

test('topicBase strips the Bangla locative ending', () => {
  assert.equal(topicBase('সমাসে'), 'সমাস');
  assert.equal(topicBase('ইংরেজিতে'), 'ইংরেজি');
  assert.equal(topicBase('বাংলায়'), 'বাংলা');
  assert.equal(topicBase('গণিত'), 'গণিত');
});

test('agentChat reads the stated weak topics before the tool shortcut and reuses the read', () => {
  const shortcut = SRC.indexOf('isSimplePlan(toolPlan, toolText)');
  const read = SRC.indexOf('statedWeak = statedWeakTopics(parseMemory(await earlyLongP');
  assert.ok(read > 0 && read < shortcut, 'memory must be read before the shortcut answers');
  assert.ok(SRC.includes('(earlyLongP || safeRead(() => stateGet(memKeyEarly)))'), 'no second read');
  assert.ok(SRC.includes('statedWeak, kv: env && env.PUB_KV }).catch'));
  assert.ok(SRC.includes('runTools([extraTools], { stats, statedWeak,'));
});
