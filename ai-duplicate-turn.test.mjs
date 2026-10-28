// 🐞 Regression: the AI tutor sent every chat message to the model twice.
// Student typed "৮" and the reply read it as "৮৮" because the same user turn
// was appended twice (send() pushes it, then callStream() concatenated it again).
// These tests fail on the old code and pass on the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateChatReq } from './ai-agent.js';

const SRC = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');

// Pull the real body of send() out of the shipped file, up to the network call.
function sendBody(src) {
  const start = src.indexOf('async function send(text) {');
  assert.notEqual(start, -1, 'send() not found in ai-agent-chat.js');
  const end = src.indexOf('const res = await ask(', start);
  assert.notEqual(end, -1, 'the ask() call inside send() was not found');
  return src.slice(src.indexOf('{', start) + 1, end);
}

// Execute that body with the minimum surroundings, returning what it produced.
async function runSend(src, typed) {
  const body = sendBody(src);
  const msgs = [];
  const sessions = [{ name: '', msgs }];
  const asked = [];
  const fn = new Function(
    'text', 'sessions', 'cur', 'inpEl', 'document', 'window', 'save', 'renderMsgs', 'msgsEl',
    'liveNode', 'setBusy', 'mood', 'MAX_HISTORY', 'ask', 'T', 'replaceStream', 'asked', 'procStage',
    'instrParse', 'instrRun', 'profilePayload',
    `return (async () => { let busy = 0; let activeReq = null; ${body}
      asked.push(history);
      return { asked, msgs: sessions[0].msgs }; })();`
  );
  const ask = async (history) => { asked.push(history); return { ok: true, text: 'ok' }; };
  return fn(
    typed, sessions, 0, { value: typed, style: {}, blur() {} },
    { getElementById: () => null },
    /* send() reaches for optional page singletons (SkySmallTalk, SkyFAQ,
       SkyTools); an empty object makes each of those branches a no-op. */
    {},
    () => {}, () => {}, { querySelector: () => null },
    null, () => {}, () => {}, 12, ask, {}, () => {}, asked,
    /* send() now reports live stages through procStage(); a no-op is enough here. */
    () => {},
    /* Sky custom instructions: send() checks them first. Null keeps this test
       on the duplicate-turn path it is actually about. */
    () => null, () => null,
    /* No cached profile in this harness, so there is no first name to greet. */
    () => null
  );
}

test('send() runs without referencing an undefined identifier', async () => {
  // A ReferenceError here is the page-level crash the owner saw.
  await assert.doesNotReject(() => runSend(SRC, '৮'), 'send() threw');
});

test('send() hands the model the current turn exactly once', async () => {
  const { asked, msgs } = await runSend(SRC, '৮');
  assert.equal(asked.length, 1, 'ask() must be called once per send()');
  const userTurns = asked[0].filter((m) => m.role === 'user');
  assert.equal(userTurns.length, 1, 'the model must receive one user turn, not two');
  // The question must survive: a guard that strips it leaves the model with an
  // empty history and no question to answer.
  assert.equal(userTurns[0].content, '৮', "the student's own turn was dropped");
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].text, '৮');
});

test('the pending AI placeholder is never sent to the model', async () => {
  const { asked } = await runSend(SRC, 'প্রশ্ন');
  assert.equal(asked[0].some((m) => m.content === '' || m.content === undefined), false,
    'an empty placeholder turn reached the model');
});

test('validateChatReq cannot emit consecutive user turns', () => {
  const res = validateChatReq({
    messages: [
      { role: 'user', content: '৮' },
      { role: 'user', content: '৮' },
    ],
    fresh: false,
  });
  assert.equal(res.ok, true);
  const userTurns = res.messages.filter((m) => m.role === 'user');
  assert.equal(userTurns.length, 1, 'consecutive user turns must be merged');
  assert.ok(userTurns[0].content.includes('৮'));
});

test('validateChatReq keeps real turn boundaries intact', () => {
  const res = validateChatReq({
    messages: [
      { role: 'user', content: 'প্রশ্ন' },
      { role: 'assistant', content: 'উত্তর' },
      { role: 'user', content: 'আরেক প্রশ্ন' },
    ],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.messages.map((m) => m.role),
    ['user', 'assistant', 'user']
  );
  assert.equal(res.messages[2].content, 'আরেক প্রশ্ন');
});
