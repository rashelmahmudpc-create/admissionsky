/* P27 — the owner's phone alert, through the real worker entry point.
 *
 * The client reporter posts to /api/report-error and the worker forwards to
 * Telegram. These tests pin what a unit test of the handler cannot see: that
 * the route is reachable without the X-AH-App header (the browser sends none),
 * that it is still closed to everyone else, and that the shipped bundle behaves
 * exactly like the source.
 *
 * `fetch` is stubbed because it is the outbound boundary — the assertion is on
 * the request that would leave the worker, not on Telegram's reply.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sourceWorker from './gk-agent-worker.js';
import bundledWorker from './worker-bundle.mjs';

function kv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const puts = [];
  return {
    store,
    puts,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) { puts.push({ k, v, opts }); store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cursor: undefined }; },
  };
}

function env(overrides = {}) {
  return {
    TG_BOT_TOKEN: '123456:AAHtest-token-not-real',
    TG_CHAT_ID: '8160600900',
    GK_KV: kv(),
    ...overrides,
  };
}

const workerFetch = (worker, request, e) => worker.fetch(request, e, { waitUntil() {}, passThroughOnException() {} });

function reportRequest(body, headers = {}) {
  return new Request('https://worker/api/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ah-pages-proxy': '1', ...headers },
    body: JSON.stringify(body),
  });
}

const sample = (extra = {}) => ({
  message: 'TypeError: cannot read x',
  path: '/study',
  source: 'window.onerror',
  release: 'welcome-abc',
  signature: 'sig-1',
  ...extra,
});

/** Capture every outbound fetch; `ok` decides what Telegram "answers". */
function stubFetch({ ok = true, throws = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (throws) throw new Error('network down');
    return { ok, status: ok ? 200 : 400, async json() { return { ok }; } };
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

const telegramText = (call) => JSON.parse(call.init.body).text;
const telegramChat = (call) => JSON.parse(call.init.body).chat_id;

for (const [name, worker] of [['source', sourceWorker], ['bundle', bundledWorker]]) {
  test(`p27-১ (${name}): a same-origin report reaches Telegram with the fixed chat`, async () => {
    const stub = stubFetch();
    try {
      const res = await workerFetch(worker, reportRequest(sample()), env());
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { sent: true });
      assert.equal(stub.calls.length, 1);
      assert.match(stub.calls[0].url, /^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/);
      assert.equal(telegramChat(stub.calls[0]), '8160600900');
      assert.match(telegramText(stub.calls[0]), /TypeError: cannot read x/);
      assert.match(telegramText(stub.calls[0]), /\/study/);
    } finally { stub.restore(); }
  });

  test(`p27-২ (${name}): the Pages Origin header alone is NO LONGER enough`, async () => {
    /* BUG-003 (2026-10-25 audit): Origin is set by the caller, so accepting it
       as proof let any script inject text into the owner's alert channel. The
       Pages proxy stamps x-ah-pages-proxy on what it forwards, and that header
       cannot survive a cross-origin call, so it is the real signal. This test
       used to assert the opposite; it now pins the fix. */
    const stub = stubFetch();
    try {
      const req = new Request('https://worker/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://admissionhub.pages.dev' },
        body: JSON.stringify(sample()),
      });
      assert.equal((await workerFetch(worker, req, env())).status, 403);
      assert.equal(stub.calls.length, 0, 'a forged Origin must not reach Telegram');
    } finally { stub.restore(); }
  });

  test(`p27-৩ (${name}): anyone else is refused and nothing is sent`, async () => {
    const stub = stubFetch();
    try {
      const bare = new Request('https://worker/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sample()),
      });
      const res = await workerFetch(worker, bare, env());
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'forbidden');

      const foreign = reportRequest(sample(), { Origin: 'https://evil.example', 'x-ah-pages-proxy': '' });
      assert.equal((await workerFetch(worker, foreign, env())).status, 403);
      assert.equal(stub.calls.length, 0, 'no alert may leave for an unverified caller');
    } finally { stub.restore(); }
  });

  test(`p27-৪ (${name}): the same error twice alerts once (render loop guard)`, async () => {
    const stub = stubFetch();
    const e = env();
    try {
      assert.deepEqual(await (await workerFetch(worker, reportRequest(sample()), e)).json(), { sent: true });
      const second = await workerFetch(worker, reportRequest(sample()), e);
      assert.equal(second.status, 200);
      assert.equal((await second.json()).skipped, 'duplicate');
      assert.equal(stub.calls.length, 1, 'a repeat of the same signature must stay silent');

      const other = await workerFetch(worker, reportRequest(sample({ signature: 'sig-2', path: '/quiz' })), e);
      assert.deepEqual(await other.json(), { sent: true });
      assert.equal(stub.calls.length, 2, 'a different error is still reported');
    } finally { stub.restore(); }
  });

  test(`p27-৫ (${name}): the hourly cap stops a flood`, async () => {
    const stub = stubFetch();
    const e = env();
    try {
      for (let i = 0; i < 20; i++) {
        const res = await workerFetch(worker, reportRequest(sample({ signature: `sig-${i}` })), e);
        assert.deepEqual(await res.json(), { sent: true }, `alert ${i} should send`);
      }
      const capped = await workerFetch(worker, reportRequest(sample({ signature: 'sig-over' })), e);
      assert.equal((await capped.json()).skipped, 'hourly-cap');
      assert.equal(stub.calls.length, 20);
    } finally { stub.restore(); }
  });

  test(`p27-৬ (${name}): a failed send is retried, not silenced`, async () => {
    const stub = stubFetch({ ok: false });
    const e = env();
    try {
      const res = await workerFetch(worker, reportRequest(sample()), e);
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error, 'telegram-failed');
      assert.equal(e.GK_KV.puts.filter(p => p.k.startsWith('alert:')).length, 0,
        'a failed alert must not leave a marker behind');
    } finally { stub.restore(); }

    const retry = stubFetch();
    try {
      assert.deepEqual(await (await workerFetch(worker, reportRequest(sample()), e)).json(), { sent: true });
    } finally { retry.restore(); }
  });

  test(`p27-৭ (${name}): a throwing fetch is contained`, async () => {
    const stub = stubFetch({ throws: true });
    try {
      const res = await workerFetch(worker, reportRequest(sample()), env());
      assert.equal(res.status, 502);
    } finally { stub.restore(); }
  });

  test(`p27-৮ (${name}): no Telegram token means a quiet skip, not a crash`, async () => {
    const stub = stubFetch();
    try {
      const res = await workerFetch(worker, reportRequest(sample()), env({ TG_BOT_TOKEN: '', TG_CHAT_ID: '' }));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).skipped, 'telegram-not-configured');
      assert.equal(stub.calls.length, 0);
    } finally { stub.restore(); }
  });

  test(`p27-৯ (${name}): an empty message is refused`, async () => {
    const stub = stubFetch();
    try {
      const res = await workerFetch(worker, reportRequest({ message: '   ' }), env());
      assert.equal(res.status, 400);
      assert.equal(stub.calls.length, 0);
    } finally { stub.restore(); }
  });

  test(`p27-১০ (${name}): the caller cannot choose the chat or overflow the message`, async () => {
    const stub = stubFetch();
    try {
      const res = await workerFetch(worker, reportRequest(sample({
        chat_id: '999999',
        message: 'x'.repeat(5000),
      })), env());
      assert.equal(res.status, 200);
      assert.equal(telegramChat(stub.calls[0]), '8160600900', 'the chat is fixed server-side');
      assert.ok(telegramText(stub.calls[0]).length < 1000, 'the message is truncated, not forwarded whole');
    } finally { stub.restore(); }
  });

  test(`p27-১১ (${name}): control characters are stripped from the alert text`, async () => {
    const stub = stubFetch();
    try {
      await workerFetch(worker, reportRequest(sample({ message: 'bad\u0007null\u0000msg', path: '/a\u001b' })), env());
      const text = telegramText(stub.calls[0]);
      assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), 'no control characters may reach Telegram');
    } finally { stub.restore(); }
  });
}
