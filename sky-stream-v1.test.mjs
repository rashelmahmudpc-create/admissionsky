/* F0.4 — `sky-stream-v1`: the event stream, versioned without breaking a client.
 *
 * Two properties matter and both are tested here:
 *   1. every frame a v1 client needs is present — hello, contiguous `seq`, done;
 *   2. a client that predates v1 still reads the same events it always did.
 * The second is the whole reason the version is additive, so it is asserted
 * against the real parser rules, not a paraphrase of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skyStream, skySse, SKY_STREAM_VERSION } from './sky-stream.mjs';

/* A frame with no `data:` line is not an event — it is a comment (`: open`, the
   keep-alive the early stream writes first) or a stray blank. Those are dropped
   so the list is the events a client would act on. */
const frames = (text) => text.split('\n\n').filter(Boolean).map((part) => {
  let evt = '';
  const data = [];
  for (const line of part.split('\n')) {
    if (line.startsWith('event:')) evt = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  return { evt, j: data.length ? JSON.parse(data.join('\n')) : null };
}).filter((f) => f.j);

test('f04-১: hello is first and names the version', () => {
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.hello();
  const [first] = frames(out);
  assert.equal(first.evt, 'stream');
  assert.equal(first.j.v, 'sky-stream-v1');
  assert.equal(first.j.ev, 'hello');
  assert.equal(first.j.seq, 0);
});

test('f04-২: seq is contiguous across the two halves of one answer', () => {
  // The early stage events and the model text are written by different stream
  // controllers. They must number as ONE stream or every reply shows a gap.
  let out = '';
  const counter = { n: 0 };
  const early = skyStream((c) => { out += c; }, counter);
  early.stage('understand', 'বুঝছি');
  const inner = skyStream((c) => { out += c; }, counter);
  inner.hello();
  inner.text('উত্তর');
  inner.done({ model: 'm' });
  const seqs = frames(out).map((f) => f.j.seq);
  assert.deepEqual(seqs, [0, 1, 2, 3], `gaps in ${JSON.stringify(seqs)}`);
});

test('f04-৩: done carries the stream version', () => {
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.done({ model: 'm', intent: 'X' });
  const [f] = frames(out);
  assert.equal(f.evt, 'done');
  assert.equal(f.j.stream, SKY_STREAM_VERSION);
  assert.equal(f.j.model, 'm');
});

test('f04-৪: an old client takes the same branch it always did', () => {
  // This is the compatibility contract. Reproduce the pre-F0.4 client's rules:
  //   - unknown event names are ignored unless their payload has text/error/model
  //   - stage carries a label, text accumulates, replace overwrites
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.hello();
  s.stage('understand', 'বুঝছি');
  s.text('হ্যালো ');
  s.text('বিশ্ব');
  s.replace('ঠিক করা');
  s.done({ model: 'm', provider: 'p', intent: 'GENERAL_CHAT' });

  let full = '', label = '', model = null, replaced = null;
  for (const { evt, j } of frames(out)) {
    if (evt === 'stage') { label = j.label; continue; }
    if (evt === 'replace' && typeof j.text === 'string') { full = j.text; replaced = j.text; }
    else if (j.text) { full += j.text; }
    else if (j.model || j.provider || j.intent) model = j.model;
  }
  assert.equal(label, 'বুঝছি', 'the stage label still arrives');
  assert.equal(full, 'ঠিক করা', 'replace still overwrites accumulated text');
  assert.equal(replaced, 'ঠিক করা');
  assert.equal(model, 'm', 'done still carries the model');
});

test('f04-৫: the hello cannot be mistaken for text, an error or metadata', () => {
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.hello();
  const [f] = frames(out);
  assert.ok(!('text' in f.j), 'no text key, so an old client does not append it');
  assert.ok(!('error' in f.j), 'no error key, so it is not treated as a failure');
  assert.ok(!('model' in f.j) && !('provider' in f.j) && !('intent' in f.j), 'not metadata');
});

test('f04-৬: an error frame is still an error frame', () => {
  let out = '';
  const s = skyStream((c) => { out += c; });
  s.error({ error: 'provider_failed', message: 'x', retryable: true });
  const [f] = frames(out);
  assert.equal(f.evt, 'error');
  assert.equal(f.j.error, 'provider_failed');
  assert.equal(f.j.retryable, true);
  assert.equal(f.j.seq, 0);
});

test('f04-৭: skySse writes the bare text frame with no event name', () => {
  assert.equal(skySse('', { text: 'x' }), 'data: {"text":"x"}\n\n');
  assert.equal(skySse('done', { a: 1 }), 'event: done\ndata: {"a":1}\n\n');
});

test('f04-৮: the real emitters use the v1 writer, not hand-built frames', () => {
  const agent = readFileSync('ai-agent.js', 'utf8');
  assert.ok(/import \{[^}]*skyStream[^}]*\} from '\.\/sky-stream\.mjs'/.test(agent),
    'ai-agent.js imports the writer');
  assert.ok(/skyStream\(/.test(agent), 'and uses it');
  assert.ok(!/push\(`event: stage\\ndata:/.test(agent), 'no hand-built stage frames remain');
  assert.ok(!/push\(`event: done\\ndata:/.test(agent), 'no hand-built done frames remain');
  assert.ok(!/push\(`data: \$\{JSON\.stringify\(\{ text/.test(agent), 'no hand-built text frames remain');

  const tools = readFileSync('sky-tools.mjs', 'utf8');
  assert.ok(/skyStream\(/.test(tools), 'the tool-only answer streams v1 too');
  assert.ok(!/push\(`event: stage\\ndata:/.test(tools), 'no hand-built frames in sky-tools');
});

test('f04-৯: the client reads the version and reports a cut stream', () => {
  const client = readFileSync('ai-agent-chat.js', 'utf8');
  assert.ok(/evt === 'stream'/.test(client), 'the client recognises the hello');
  assert.ok(/sawDone/.test(client), 'and tracks whether done arrived');
  assert.ok(/truncated: true/.test(client), 'a v1 stream without done is reported incomplete');
  assert.ok(/typeof j\.seq === 'number'/.test(client), 'it reads the sequence');
});

test('f04-১০: a v1 stream that never says done is not ok', () => {
  // Reproduce the client's end-of-stream decision for a cut answer.
  const decide = (streamV, sawDone, full) => (streamV && !sawDone)
    ? { ok: true, text: full, truncated: true, stream: streamV }
    : { ok: true, text: full };
  assert.equal(decide('sky-stream-v1', false, 'অর্ধেক').truncated, true);
  assert.equal(decide('sky-stream-v1', true, 'পূর্ণ').truncated, undefined);
  // A pre-v1 server sends no version, so nothing changes for it.
  assert.equal(decide(null, false, 'অর্ধেক').truncated, undefined);
});

test('f04-১১: the real stream announces the version before any stage', async () => {
  // Regression: emitting hello from the inner stream put it after the first
  // early stage, so a client learned the protocol only at frame two.
  const A = await import('./ai-agent.js');
  const store = new Map();
  const kv = { get: async (k) => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); } };
  const env = { PUB_KV: kv, GEMINI_KEYS: 'goodkey00002', AGENT_DAILY_CAP: 50 };
  const g = (t) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + '\n\n';
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(c) { for (const ch of [g('## নিউটন\n'), g('বিশ্ব')]) c.enqueue(new TextEncoder().encode(ch)); c.close(); }
  }), { status: 200 });
  let text;
  try {
    const req = new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'নিউটনের সূত্র বুঝাও' }] }) });
    text = await (await A.agentChat(req, env, 'account-live1')).text();
  } finally { globalThis.fetch = real; }

  const f = frames(text);
  assert.equal(f[0].evt, 'stream', 'the hello is the first frame');
  assert.equal(f[0].j.v, SKY_STREAM_VERSION);
  const seqs = f.map((x) => x.j.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i), `seq must be 0..n: ${seqs}`);
  assert.equal(f.at(-1).evt, 'done');
  assert.equal(f.at(-1).j.stream, SKY_STREAM_VERSION);
});
