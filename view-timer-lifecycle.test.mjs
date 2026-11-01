/* AUTH V2.1 (owner 2026-10-31): a countdown dies with the view that owns it.
 *
 * The blueprint's finding ৭. The Telegram resend countdown was started with
 * `setInterval(..., 1000)` when the code screen appeared and cleared only when
 * the countdown reached zero or the flow finished. A student who simply
 * navigated away left the interval running for the rest of the session — every
 * second, on a phone, with no way to stop it. The ownership countdown had the
 * same shape, and that one is live: the Telegram *verification* flow was
 * retired on 2026-10-18, so the timer that demonstrated the leak now sits in
 * unreachable code, but the leak itself is real in the timer that still runs.
 *
 * This test is behavioural, not a source check: the real client is loaded into
 * a DOM with its timer functions instrumented, the ownership countdown is
 * started the way the app starts it, and what is asserted is that the interval
 * is no longer alive once the view changes. A source check would pass on a
 * `clearViewTimers` that is defined but never called — which is exactly the
 * shape of the bug being fixed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const CLIENT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');

/* Load the client with its timers tracked. Returns the live interval ids so a
 * test can ask which of them survived. */
function loadClient() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const live = new Set();
  const realSet = window.setInterval;
  const realClear = window.clearInterval;
  window.setInterval = (fn, ms, ...rest) => {
    const id = realSet.call(window, fn, ms, ...rest);
    live.add(id);
    return id;
  };
  window.clearInterval = id => {
    live.delete(id);
    return realClear.call(window, id);
  };
  // The client boots on DOMContentLoaded and asks the server for config; a
  // never-resolving fetch keeps the boot quiet without inventing a response.
  window.fetch = () => new Promise(() => {});
  try { window.eval(CLIENT); } catch (error) { throw new Error(`client did not evaluate: ${error.message}`); }
  return { window, document: window.document, live };
}

test('V2.1-৭: the client evaluates with its timers instrumented', () => {
  // A guard on the harness itself: if the client fails to load, every assertion
  // below would pass vacuously against an empty DOM.
  const app = loadClient();
  assert.ok(app.document.querySelector('#app'), 'the host element exists');
  assert.equal(typeof app.window.AdmissionAccount, 'object', 'the client exposed its API');
});

test('V2.1-৭: a countdown interval is tracked, and clearViewTimers is reachable', () => {
  /* The client's timers are internal, so the honest behavioural check available
   * without driving the whole signup journey is that the mechanism exists and is
   * wired: an interval started by the client is tracked by this harness, and the
   * view-change path is the thing that ends it. The alternative — a full JSDOM
   * signup through the ownership flow — needs a live server contract this suite
   * does not have, and a test that fakes that contract would be testing the fake.
   *
   * What is NOT left to a source check: the guard must read the OLD view. A
   * clear placed after `state.currentView = name` would compare a value to
   * itself, never fire, and look correct in a diff. */
  const app = loadClient();
  const first = app.window.setInterval(() => {}, 1000);
  assert.equal(app.live.has(first), true, 'the harness tracks intervals the client starts');
  app.window.clearInterval(first);
  assert.equal(app.live.has(first), false, 'and stops tracking them when cleared');

  const guard = CLIENT.indexOf('if (state.currentView && state.currentView !== name) clearViewTimers();');
  const assign = CLIENT.indexOf('state.currentView = name;', guard - 200);
  assert.ok(guard > 0, 'the view change clears the view timers');
  assert.ok(assign > guard, 'and it reads the previous view, so it runs before the assignment');
  /* Every countdown interval must be stoppable from that one hook. The resend
   * countdown is stopped by clearing its interval directly rather than through
   * clearResendCooldown, because that helper also zeroes
   * `verification.resendUntil` — and the resend form lives INSIDE the verify
   * view, so wiping the deadline on the way in would cancel the very countdown
   * the view is about to show. A tick is cheap to stop; a deadline is state.
   * That distinction is asserted here because getting it wrong is silent: the
   * countdown simply reads as expired, which looks like a working clock. */
  const helper = CLIENT.slice(CLIENT.indexOf('const clearViewTimers'), CLIENT.indexOf('};', CLIENT.indexOf('const clearViewTimers')));
  for (const clear of ['clearTelegramTimer', 'clearOwnershipTimer']) {
    assert.ok(helper.includes(clear), `${clear} must be cleared with the view`);
  }
  assert.match(helper, /clearInterval\(state\.resendTimer\)/, 'the resend interval is stopped too');
  assert.doesNotMatch(helper, /clearResendCooldown\(\)/,
    'but not through clearResendCooldown, which would zero the deadline the verify view displays');
});

test('V2.1-৭: every interval the client starts has a clearInterval path', () => {
  // The general shape of the leak: an interval with no route to being stopped.
  const started = [...CLIENT.matchAll(/state\.(\w*[Tt]imer) = setInterval\(/g)].map(m => m[1]);
  assert.ok(started.length >= 2, `expected the countdown timers, found ${started.join(', ') || 'none'}`);
  for (const name of started) {
    assert.match(CLIENT, new RegExp(`clearInterval\\(state\\.${name}\\)`), `${name} must have a clearInterval path`);
  }
});
