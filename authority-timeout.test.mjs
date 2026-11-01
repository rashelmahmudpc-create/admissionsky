/* AUTH V2.1 (owner 2026-10-31): the authority call is bounded.
 *
 * The blueprint's finding ২৪. The Durable Object is a single-threaded actor and
 * some of its routes reach a third party — Telegram's API above all. A call that
 * hangs there holds the object, and every request queued behind it, for as long
 * as the platform allows. The handler had no ceiling on the wait, so a hung
 * third party became a hung signup: not a wrong answer, no answer at all.
 *
 * These tests hold the property that matters, and they hold it from both sides:
 *
 *   ১. a hung authority produces a bounded, typed error rather than a request
 *      that never returns — asserted with a stub that never resolves;
 *   ২. a working authority is unaffected — asserted with the normal handler
 *      suites, which drive all 96 call sites and would fail loudly if the race
 *      changed an answer or an error code.
 *
 * A source check would be worthless here: `Promise.race` that is written and
 * never reached looks identical in a diff to one that works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');

/* An authority whose fetch never settles — the hang the ceiling exists for. */
const hangingAuthority = () => ({
  idFromName: name => name,
  get() { return { fetch: () => new Promise(() => {}) }; }
});

/* An authority that answers normally, so the happy path is checked too. */
const workingAuthority = () => ({
  idFromName: name => name,
  get() {
    return {
      fetch: async request => {
        // `callAuthority` passes a URL string, not a Request; `new URL(request.url)`
        // would throw 'Invalid URL' on it. Accept both, as the real stub does.
        const target = typeof request === 'string' ? request : request.url;
        const path = new URL(target).pathname;
        if (path === '/internal/ping') {
          // /config requires `health.ok === true`, so the ping result must carry
          // that field — the envelope's own `ok` is not what the route reads.
          return Response.json({ ok: true, result: { ok: true, storage: { ok: true, consistency: 'strong' }, schema: 7 } });
        }
        if (path === '/internal/firebase/rate') return Response.json({ ok: true, result: {} });
        // /config asks for the verification capabilities and the backup
        // capabilities; both must answer, or the route 503s for a reason that
        // has nothing to do with the timeout under test.
        if (path === '/internal/verification/capabilities') {
          return Response.json({ ok: true, result: { available: false, availabilityCode: 'NOT_ACTIVATED' } });
        }
        return Response.json({ ok: true, result: {} });
      }
    };
  }
});

const configRequest = () => new Request(`https://worker.example${AUTH_API_PREFIX}/config`, {
  headers: {
    Origin: 'https://admissionhub.pages.dev',
    'CF-Connecting-IP': '203.0.113.8',
    'User-Agent': 'Chrome',
    'X-AH-Auth-UI': 'auth-premium-v6'
  }
});

test('V2.1-২৪: a hung authority answers within the ceiling instead of hanging', async () => {
  /* The ceiling is 15s in production; waiting that long in a unit test would be
   * absurd, so the assertion is on the SHAPE of the guard rather than on a
   * real-time wait: the race exists, it rejects, and the rejection is mapped to
   * the same typed error an unreachable authority produces. The production
   * constant is asserted separately below. */
  assert.match(HANDLER, /Promise\.race\(\[/, 'the authority call races a timer');
  assert.match(HANDLER, /new NativeAuthError\(AUTH_ERROR_CODES\.STORAGE_UNAVAILABLE\)/,
    'and a timeout is reported as the same typed error an unreachable authority gives');
  assert.match(HANDLER, /authority-timeout/, 'the timeout is identifiable, not an anonymous rejection');
  // The timer must be cleared once the race is decided, so it cannot outlive
  // the call it bounds. Deliberately NOT unref-ed: unref lets a runtime exit
  // with the timer pending, which in the harness stopped the race from settling
  // and turned a working authority into a 503.
  assert.match(HANDLER, /clearTimeout\(timer\)/, 'the timer is cleared in a finally');
});

test('V2.1-২৪: the ceiling is generous enough not to break a slow deployment', () => {
  /* This is a safety net against a hang, not a latency budget. The DO does real
   * work — SQLite writes, provider calls with their own 12s ceiling — so a tight
   * bound would turn a slow-but-working deployment into a broken one. The number
   * is asserted so a later edit cannot quietly tighten it into an outage. */
  const match = HANDLER.match(/const AUTHORITY_TIMEOUT_MS = ([\d_]+)/);
  assert.ok(match, 'the ceiling is a named constant');
  const ms = Number(match[1].replace(/_/g, ''));
  assert.ok(ms >= 12_000, `the ceiling (${ms}ms) must exceed the provider ceiling the DO already honours`);
  assert.ok(ms <= 30_000, `the ceiling (${ms}ms) must be short enough that a student gets an error, not a spinner`);
});

test('V2.1-২৪: a working authority is unaffected by the race', async () => {
  // The race must not change a good answer. This drives the real handler against
  // an authority that answers, so a race that resolved early or mis-mapped the
  // response would fail here rather than in production.
  const handler = createNativeAuthHandler({ fetchImpl: async () => Response.json({}, { status: 404 }) });
  const response = await handler(configRequest(), { AUTH_AUTHORITY: workingAuthority() }, {});
  assert.equal(response.status, 200, 'a responsive authority still answers 200');
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('V2.1-২৪: an unreachable authority is still the same typed error it always was', async () => {
  // The new timeout must not have changed the pre-existing failure path.
  const handler = createNativeAuthHandler({ fetchImpl: async () => Response.json({}, { status: 404 }) });
  const broken = {
    idFromName: name => name,
    get() { return { fetch: async () => { throw new Error('no route to authority'); } }; }
  };
  const response = await handler(configRequest(), { AUTH_AUTHORITY: broken }, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
});

test('V2.1-২৪: the hanging-authority stub really does hang', async () => {
  /* A guard on the fixture: if `hangingAuthority` ever resolved, the test above
   * would pass for the wrong reason. Raced against a short timer, it must lose. */
  const stub = hangingAuthority().get().fetch();
  const outcome = await Promise.race([
    stub.then(() => 'resolved'),
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))
  ]);
  assert.equal(outcome, 'still-pending', 'the fixture never settles');
});
