/* F2.5 — the daily-question meter.
 *
 * The server has always decided the quota before the answer streams
 * (`quotaState`), but `remaining` only ever travelled on the 429. The student's
 * first sight of the limit was being stopped by it — they could not see how many
 * questions they had left until they had none.
 *
 * These tests load the real `quotaNote` out of ai-agent-chat.js. The rule that
 * matters most is the refusal case: an older server sends neither number, and a
 * guessed "10 left" would be worse than showing nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync('ai-agent-chat.js', 'utf8');

const START = '  function quotaNote(remaining, cap) {';
const END = '  function paintQuota(remaining, cap) {';
const block = UI.slice(UI.indexOf(START), UI.indexOf(END, UI.indexOf(START)));
assert.ok(block.includes('quotaLeft'), 'quotaNote was not found in ai-agent-chat.js');

const T_BN = { quotaLeft: 'আজ বাকি', quotaOf: 'টি প্রশ্ন' };
const T_EN = { quotaLeft: 'Left today', quotaOf: 'questions' };
const mk = (lang, T) => new Function('lang', 'T', block + '\nreturn quotaNote;')(lang, T);
const bn = mk('bn', T_BN), en = mk('en', T_EN);

test('shows the remaining count against the cap', () => {
  const n = bn(7, 10);
  assert.ok(n, 'no meter for a reported quota');
  assert.ok(n.text.includes('৭'), 'the count is not in Bengali numerals: ' + n.text);
  assert.ok(n.text.includes('১০'), 'the cap is not in Bengali numerals: ' + n.text);
  assert.equal(n.pct, 70, 'the bar does not follow the count');
  assert.equal(n.low, false, '7 of 10 was flagged as low');
});

test('English mode keeps Western numerals', () => {
  const n = en(7, 10);
  assert.ok(n.text.includes('7') && n.text.includes('10'), n.text);
});

test('the last few questions are flagged low', () => {
  assert.equal(bn(2, 10).low, true, '2 of 10 was not flagged');
  assert.equal(bn(0, 10).low, true, 'running out was not flagged');
  assert.equal(bn(5, 10).low, false, 'half the quota was wrongly flagged');
});

test('no quota reported means no meter, never a guess', () => {
  /* The whole point: an older server sends neither number. Showing a guessed
     count would tell the student something the server never said. */
  for (const [r, c] of [[null, null], [undefined, undefined], [7, null], [null, 10], [7, undefined], [7, 0], [7, -1], ['7', '10'], [7, '10']]) {
    assert.equal(bn(r, c), null, `a meter appeared for remaining=${JSON.stringify(r)} cap=${JSON.stringify(c)}`);
  }
});

test('the count is clamped to the cap, so the bar cannot exceed 100%', () => {
  const over = bn(15, 10);
  assert.ok(over, 'a full quota should still render');
  assert.equal(over.pct, 100, 'the bar overflowed the cap');
  assert.ok(over.text.includes('১০') && !over.text.includes('১৫'), 'the count was shown above the cap: ' + over.text);
  assert.equal(bn(-3, 10).pct, 0, 'a negative remainder did not clamp to zero');
});

test('the meter is painted from the parser result and never as markup', () => {
  assert.ok(/paintQuota\(res\.remaining, res\.cap\)/.test(UI), 'the meter is not fed by the server result');
  /* The numbers are server data: they must go through textContent and style,
     never into innerHTML. */
  const paint = UI.slice(UI.indexOf('function paintQuota'), UI.indexOf('function cutNote'));
  assert.ok(/\.textContent\s*=/.test(paint), 'the meter text is not written with textContent');
  assert.ok(!/innerHTML/.test(paint), 'the meter builds markup from server data');
});

test('the parser reads remaining and cap off the done frame', () => {
  assert.ok(/if \(typeof j\.remaining === 'number'\) left = j\.remaining;/.test(UI), 'the done frame is not read for remaining');
  assert.ok(/if \(typeof j\.cap === 'number'\) capN = j\.cap;/.test(UI), 'the done frame is not read for cap');
  assert.ok(/remaining: left, cap: capN/.test(UI), 'the parser result does not carry the quota');
});

/* ── the server half ─────────────────────────────────────────────────────────
 * The client can only show what the server sends. These assert the number really
 * reaches the `done` frame, and that both server paths carry it — the live one
 * and the cache replay, which is a separate stream with its own done. */
import { skyStream } from './sky-stream.mjs';

test('the quota rides on the done frame', () => {
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.hello(); s.text('ok'); s.done({ rid: 'r1', remaining: 4, cap: 10 });
  const done = out.split('\n\n').find((p) => p.includes('event: done'));
  assert.ok(done, 'no done frame');
  const j = JSON.parse(done.split('\n').find((l) => l.startsWith('data:')).slice(5).trim());
  assert.equal(j.remaining, 4, 'remaining did not survive serialization');
  assert.equal(j.cap, 10, 'cap did not survive serialization');
});

test('both server paths put the quota on their done frame', () => {
  const S = readFileSync('ai-agent.js', 'utf8');
  /* live path */
  assert.ok(/s\.done\(\{[^}]*remaining: early\.remaining[^}]*cap: early\.cap/.test(S), 'the live done frame does not carry the quota');
  assert.ok(/early\.remaining = quota \? quota\.remaining : null;/.test(S), 'early.remaining is never set from the decided quota');
  /* cache replay: a separate stream, and it was easy to forget */
  assert.ok(/function sseCached\([^)]*remaining = null, cap = null\)/.test(S), 'sseCached does not take the quota');
  assert.ok(/s\.done\(\{[^}]*remaining, cap \}\);/.test(S), 'the cached done frame does not carry the quota');
  assert.ok(/sseCached\(cachedText, intent, startedAt, cachedModel, request, quota \? quota\.remaining : null, cap\)/.test(S), 'the cached path is not passed the quota');
  /* the cached JSON path (non-stream) too */
  assert.ok(/jsonResp\(\{ text: cachedText[^}]*remaining: quota \? quota\.remaining : null, cap \}/.test(S), 'the cached JSON reply does not carry the quota');
});
