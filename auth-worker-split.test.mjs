import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// F-04 phase 1. The auth Worker is a thin HTTP front over the authority that
// still lives in admission-gk. These guards exist because the two ways to get
// this wrong are quiet and expensive:
//
//   * declaring AdmissionAuthAuthority in the new script would create a SECOND,
//     empty authority — every session and pending OTP would simply vanish;
//   * letting the new script grow app routes would turn it into a second copy of
//     the app, which is the thing F-04 is meant to prevent.
const AUTH_TOML = readFileSync(new URL('./wrangler.auth.toml', import.meta.url), 'utf8');
const MAIN_TOML = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const ENTRY = readFileSync(new URL('./auth-worker.js', import.meta.url), 'utf8');
const MAIN_ENTRY = readFileSync(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('./auth-worker-bundle.mjs', import.meta.url), 'utf8');

test('the auth Worker borrows the authority instead of declaring a second one', () => {
  assert.match(AUTH_TOML, /^name = "admission-auth"$/m);
  const binding = AUTH_TOML.match(/\[\[durable_objects\.bindings\]\][^[]*/);
  assert.ok(binding, 'the authority binding exists');
  assert.match(binding[0], /class_name = "AdmissionAuthAuthority"/);
  assert.match(binding[0], /script_name = "admission-gk"/, 'cross-script binding keeps the existing storage');
  // A declaring script needs a migration; a borrowing one must not have any.
  assert.doesNotMatch(AUTH_TOML, /\[\[migrations\]\]/);
  // No second copy of the database either.
  assert.doesNotMatch(AUTH_TOML, /\[\[d1_databases\]\]/);
});

test('the app Worker still owns the authority class', () => {
  assert.match(MAIN_ENTRY, /export \{ AdmissionAuthAuthority \} from '\.\/auth-native\/worker\/auth-authority-do\.mjs'/);
  assert.match(MAIN_TOML, /class_name = "AdmissionAuthAuthority"/);
});

test('the auth Worker answers the auth surface and nothing else', () => {
  assert.match(ENTRY, /createNativeAuthHandler/);
  assert.match(ENTRY, /status: 404/);
  assert.doesNotMatch(ENTRY, /pubHandler|userdata-api|analytics-engine|sky-ai-route/);
});

test('the auth bundle carries no app code', () => {
  // The whole point of the split: this script cannot take the app down with it.
  for (const appOnly of ['AiStateObject', 'VoiceAgentSession', 'handleFilesStorageRequest']) {
    assert.equal(BUNDLE.includes(appOnly), false, `${appOnly} must not be in the auth bundle`);
  }
  assert.ok(BUNDLE.includes('AUTH_API_PREFIX'), 'the auth routes are in there');
});

test('the built entry really serves only the auth surface', async () => {
  const { default: worker } = await import('./auth-worker-bundle.mjs');
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = path => worker.fetch(
    new Request(`https://admission-auth.example${path}`, { headers: { 'X-AH-Auth-UI': 'auth-premium-v6' } }),
    {},
    ctx
  );

  assert.equal((await call('/index.html')).status, 404, 'the app shell is not served here');
  assert.equal((await call('/api/ask')).status, 404, 'app APIs are not served here');
  // With no authority bound the handler answers with its own error; the point is
  // that the request reached the handler instead of the 404 fallback.
  const auth = await call('/api/auth/v1/config');
  assert.notEqual(auth.status, 404, 'auth routes reach the real handler');
  const body = await auth.json();
  assert.equal(body.ok, false);
  assert.ok(body.error?.code, 'the handler produces its own error shape');

  // F-04: the answer carries the mark the app's smoke test looks for. Without
  // it, a deploy cannot tell forwarding apart from the in-process fallback, and
  // the split could be dead while every check stayed green.
  assert.equal(auth.headers.get('X-AH-Auth-Front'), 'admission-auth');
  // Provenance of the caller's address, measured rather than assumed: the rate
  // limiter and the guard are useless if every forwarded request looks alike.
  assert.equal(auth.headers.get('X-AH-Client-Addr'), 'absent', 'this call had no edge address to carry');
  const other = await call('/index.html');
  assert.equal(other.headers.get('X-AH-Auth-Front'), null, 'only answers from this script are marked');
  assert.equal((await auth.json().catch(() => null)), null, 'the body was not consumed by marking it');
});
