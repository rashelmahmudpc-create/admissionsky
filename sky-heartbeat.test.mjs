/* F2 — the stream is never silent for 3 seconds.
 *
 * F2's Done-condition is explicit: "৩ সেকেন্ড নীরব কখনো নয়" (never three seconds
 * of silence). Nothing enforced it. The provider's first token may take up to
 * AGENT_FIRST_CHUNK_MS (5 s by default), and a retry after a dead key adds more
 * on top, so between `hello` and the first text the connection sat idle well
 * past the budget with no frame at all.
 *
 * The keep-alive must be invisible to the client, so these tests hold two
 * things: a frame really is written on the interval, and that frame is one both
 * the pre-v1 parser and a v1 one ignore. If it ever gained a `data:` line it
 * would become an event, and an event a client acts on is not a keep-alive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startHeartbeat, SKY_HEARTBEAT_MS } from './sky-stream.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a heartbeat frame is written on the interval', async () => {
  const seen = [];
  const stop = startHeartbeat((s) => seen.push(s), 40);
  await sleep(150);
  stop();
  assert.ok(seen.length >= 2, `expected at least 2 frames in 150ms, saw ${seen.length}`);
});

test('the frame is a comment, so no client can read it as an event', async () => {
  const seen = [];
  const stop = startHeartbeat((s) => seen.push(s), 30);
  await sleep(80);
  stop();
  assert.ok(seen.length > 0, 'expected at least one frame');
  for (const f of seen) {
    assert.equal(f, ': hb\n\n');
    /* The real parser rule: a part with no `data:` line yields no event. Assert
       the property rather than the literal, so a future rewrite of the frame is
       still held to being invisible. */
    const lines = f.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(!lines.some((l) => l.startsWith('data:')), `frame carries data: -> ${JSON.stringify(f)}`);
    assert.ok(!lines.some((l) => l.startsWith('event:')), `frame carries event: -> ${JSON.stringify(f)}`);
  }
});

test('the timer stops, so it cannot outlive the stream', async () => {
  let n = 0;
  const stop = startHeartbeat(() => { n++; }, 25);
  await sleep(70);
  stop();
  const afterStop = n;
  await sleep(90);
  assert.equal(n, afterStop, 'frames continued after stop()');
});

test('a throwing push never breaks the stream', async () => {
  /* The heartbeat exists to protect the stream, so it must not be the thing that
     kills it. A closed controller throws on enqueue in the real writer. */
  let calls = 0;
  const stop = startHeartbeat(() => { calls++; throw new Error('closed'); }, 20);
  await sleep(90);
  stop();
  assert.ok(calls >= 2, 'the interval stopped after a throw instead of continuing');
});

test('a zero or garbage interval cannot spin, it falls back to the default', async () => {
  for (const bad of [0, -5, NaN, 'nonsense']) {
    let n = 0;
    const stop = startHeartbeat(() => { n++; }, bad);
    await sleep(60);
    stop();
    /* The fallback is the 2000 ms default, so 60 ms must produce no frame. If the
       value were used as-is, `setInterval(fn, 0)` would fire continuously and this
       would be large. */
    assert.ok(n === 0, `interval ${String(bad)} was used instead of the default (fired ${n} times)`);
  }
});

test('the default interval is inside the 3-second budget', () => {
  assert.ok(SKY_HEARTBEAT_MS < 3000, `default ${SKY_HEARTBEAT_MS}ms leaves a gap the Done-condition forbids`);
});
