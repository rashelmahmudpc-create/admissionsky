/* F2 — a cut answer says so.
 *
 * F0.4 taught the stream parser to notice a stream that ends before `done` and
 * to report `truncated: true`, so a chopped reply could stop passing for a short
 * one. Nothing read the flag: the UI stored `res.text` and moved on, so the
 * student still saw a partial answer with no sign anything had gone wrong, and
 * the fix had no effect on the screen.
 *
 * These tests load the real `cutNote` out of ai-agent-chat.js and drive it, and
 * assert the wiring that feeds it. The escaping case matters because the retry
 * button re-sends the student's own question through `data-q`, which the click
 * handler reads back as an attribute — so an unescaped quote would break out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync('ai-agent-chat.js', 'utf8');

const T_STUB = {
  cutOff: 'উত্তরটা মাঝপথে কেটে গেছে — পুরোটা আসেনি।',
  retry: 'আবার চেষ্টা করো',
};

const START = '  function cutNote(m) {';
const END = '  function bubble(m, idx) {';
const block = UI.slice(UI.indexOf(START), UI.indexOf(END, UI.indexOf(START)));
assert.ok(block.includes('m.cutOff'), 'cutNote was not found in ai-agent-chat.js');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cutNote = new Function('esc', 'T', block + '\nreturn cutNote;')(esc, T_STUB);

test('a cut answer renders a note; an intact one renders nothing', () => {
  const cut = cutNote({ cutOff: true, q: 'সমাস কী' });
  assert.ok(cut.includes('faqm cut'), 'no cut styling class');
  assert.ok(cut.includes(T_STUB.cutOff), 'the student is not told the answer was cut');
  assert.equal(cutNote({ q: 'সমাস কী' }), '', 'a normal answer grew a warning');
  assert.equal(cutNote({ cutOff: true, pending: true }), '', 'the note showed while still streaming');
});

test('the retry button re-sends the same question', () => {
  const html = cutNote({ cutOff: true, q: 'নেকলেস গল্পের মূলভাব' });
  assert.ok(html.includes('data-q="নেকলেস গল্পের মূলভাব"'), 'retry does not carry the question');
  assert.ok(html.includes(T_STUB.retry), 'no retry label');
});

test('the question is escaped, so it cannot break out of the attribute', () => {
  const html = cutNote({ cutOff: true, q: '"><img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'), 'raw markup reached the note');
  assert.ok(html.includes('&quot;&gt;&lt;img'), 'the question was not escaped');
});

test('a missing question still renders the note, without a broken button', () => {
  const html = cutNote({ cutOff: true });
  assert.ok(html.includes(T_STUB.cutOff), 'the warning is missing when q is absent');
  assert.ok(html.includes('data-q=""'), 'the retry button has no attribute to read');
});

test('the note is wired into the bubble and fed by the parser flag', () => {
  assert.ok(/cutNote\(m\)/.test(UI), 'cutNote is never rendered in the bubble');
  /* The whole point of F0.4 was that `truncated` means something. If the UI stops
     reading it, the flag goes back to being dead code. */
  assert.ok(/res\.truncated\)\s*holder\.cutOff\s*=\s*true/.test(UI), 'res.truncated is not recorded on the message');
  assert.ok(/pending:\s*true,\s*stage:\s*T\.stageRead,\s*steps:\s*\[\],\s*q:\s*t/.test(UI), 'the holder does not keep the question the retry needs');
});

test('both language tables carry the strings', () => {
  for (const key of ['cutOff', 'retry']) {
    const hits = UI.match(new RegExp('\\b' + key + ':', 'g')) || [];
    assert.ok(hits.length >= 2, `"${key}" is not in both the Bengali and English tables (found ${hits.length})`);
  }
});
