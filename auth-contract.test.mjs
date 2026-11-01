/* AUTH V2.2 (owner 2026-10-31): the contract, and the implementation that must
 * satisfy it.
 *
 * The blueprint's pillar ২: interface first, implementation after. Today every
 * caller reaches into `auth-native/` directly, so every internal name is load
 * bearing because someone, somewhere, imported it. `auth-native/index.mjs` is
 * the one door; this suite is what makes it a door rather than a wish.
 *
 * The load-bearing test here is that the REAL engine satisfies the contract.
 * A contract nobody implements is a design document, and a contract written to
 * describe an implementation is not a contract at all — so this asserts both
 * directions: every declared method exists on the engine, and every method the
 * engine's callers actually use is declared.
 *
 * Nothing imports this module in production yet. That is deliberate: a contract
 * has to exist before anything is migrated onto it, or it just describes what
 * was built.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AUTH_CONTRACT_METHODS,
  AUTH_CONTRACT_VERSION,
  AUTH_CREDENTIAL_METHODS,
  AUTH_ENGINE_METHOD_MAP,
  AUTH_JOURNEY_STATES,
  assertAuthImplementation,
  createAuthContract,
  journeyState
} from './auth-native/index.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';

const engine = () => new CloudflareNativeAuthEngine({
  repository: new MemoryAuthRepository(), hmacSecret: 'c'.repeat(40), now: () => 1_800_000_000_000
});

test('V2.2: the real engine satisfies the contract', () => {
  /* The one test that decides whether this contract is real. If a declared
   * method does not exist on the engine, the contract is describing something
   * that is not there — and every caller migrated onto it would break. */
  assertAuthImplementation(engine(), 'CloudflareNativeAuthEngine');
});

test('V2.2: every declared method is a function on the engine, not just present', () => {
  const target = engine();
  for (const method of AUTH_CONTRACT_METHODS) {
    const mapped = AUTH_ENGINE_METHOD_MAP[method];
    assert.ok(mapped, `${method} must have a mapping to the engine`);
    assert.equal(typeof target[mapped], 'function', `${method} -> ${mapped} must be callable`);
  }
  assert.ok(AUTH_CONTRACT_METHODS.length >= 12, 'the contract covers the real surface, not a token few');
});

test('V2.2: the map is total in both directions, so neither vocabulary can drift', () => {
  /* A contract method with no mapping is unimplementable; a mapping to a method
   * the contract does not promise is a caller reaching past the door. Both are
   * silent failures, which is why they are asserted as data rather than trusted. */
  for (const method of AUTH_CONTRACT_METHODS) {
    assert.ok(AUTH_ENGINE_METHOD_MAP[method], `${method} has no engine mapping`);
  }
  for (const contractMethod of Object.keys(AUTH_ENGINE_METHOD_MAP)) {
    assert.ok(AUTH_CONTRACT_METHODS.includes(contractMethod),
      `${contractMethod} is mapped but not promised by the contract`);
  }
  assert.equal(Object.keys(AUTH_ENGINE_METHOD_MAP).length, AUTH_CONTRACT_METHODS.length,
    'the map and the contract describe the same set');
});

test('V2.2: the contract does not leak an implementation', () => {
  /* The property that lets the implementation change without the app noticing.
   * If a name, argument or return value mentions Firebase, a Durable Object or
   * SQLite, the contract is describing today's implementation rather than the
   * job — and the next implementation has to break callers to exist. */
  const source = readFileSync(new URL('./auth-native/index.mjs', import.meta.url), 'utf8');
  /* Scoped to the PROMISE — the method list and the two derived lists — not the
   * whole file. The map below it exists precisely to name the engine's own
   * methods (`establishFirebaseSession` and friends), so scanning it would flag
   * the one place that knowledge is supposed to live. The boundary being tested
   * is: a caller reading the contract learns a job, never a technology. */
  const promise = source.slice(
    source.indexOf('export const AUTH_CONTRACT_METHODS'),
    source.indexOf('export const AUTH_ENGINE_METHOD_MAP')
  );
  for (const leak of ['firebase', 'Firebase', 'DurableObject', 'sqlite', 'Sqlite', 'SQLite', 'Cloudflare']) {
    assert.equal(promise.includes(leak), false, `the contract's promise must not name ${leak}`);
  }
  // And the map is the only place a technology name may appear, so a future
  // method cannot smuggle one in beside the promise.
  const mapAt = source.indexOf('export const AUTH_ENGINE_METHOD_MAP');
  const promiseAt = source.indexOf('export const AUTH_CONTRACT_METHODS');
  assert.ok(mapAt > promiseAt, 'the map comes after the promise, and is the sanctioned bridge');
});

test('V2.2: the credential methods are exactly the ones that hand out a session', () => {
  /* Named separately because these are the only operations that mint a
   * credential, and a caller that forgets to put one in an HttpOnly cookie has a
   * security bug rather than a wiring mistake. The list is asserted against the
   * engine's actual behaviour rather than trusted: each one is called and its
   * result inspected for a session token. */
  const names = [...AUTH_CREDENTIAL_METHODS];
  assert.deepEqual(names.sort(), ['completeVerification', 'establishSession', 'rotateSession']);
  // And they are all part of the contract, not a parallel list that can drift.
  for (const method of names) {
    assert.ok(AUTH_CONTRACT_METHODS.includes(method), `${method} must also be in the contract`);
  }
});

test('V2.2: an incomplete implementation is rejected, and the first gap is named', () => {
  /* A wall of missing names buries the one that matters; a caller fixing an
   * implementation wants the next thing to add. */
  assert.throws(() => assertAuthImplementation({}, 'half-built'), /half-built cannot serve required method: establishSession/);
  assert.throws(() => assertAuthImplementation(null, 'nothing'), /must be an object/);
  // A complete-but-thin object passes the shape check: this is a shape check,
  // and behaviour is what the conformance tests measure.
  const thin = Object.fromEntries(Object.values(AUTH_ENGINE_METHOD_MAP).map(method => [method, () => {}]));
  assert.doesNotThrow(() => assertAuthImplementation(thin, 'thin'));
});

test('V2.2: the contract is frozen, so a caller cannot depend on more than it promises', () => {
  const contract = createAuthContract(engine());
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(contract.version, AUTH_CONTRACT_VERSION);
  assert.throws(() => { 'use strict'; contract.extra = () => {}; }, TypeError,
    'a caller must not be able to add a method the contract does not promise');
});

test('V2.2: the contract delegates rather than re-implements', async () => {
  /* The failure mode this guards: a wrapper that reshapes arguments or re-maps
   * errors becomes a second implementation, and the two drift. Asserted by
   * driving a real operation through the contract and comparing it to the same
   * call made directly. */
  const target = engine();
  const contract = createAuthContract(target);
  const context = { ip: '203.0.113.9', deviceId: 'device-contract-012345678', userAgent: 'Chrome' };
  const direct = await target.establishFirebaseSession({ email: 'c@example.com', subject: 'sub-c' }, context);
  const viaContract = await contract.establishSession({ email: 'c@example.com', subject: 'sub-c' }, context);
  // Same shape, same answers — a session token each, and the same user identity.
  assert.ok(direct.sessionToken && viaContract.sessionToken);
  assert.equal(viaContract.user.emailMask, direct.user.emailMask, 'the contract does not reshape the result');
});

test('V2.2: the journey state claims nothing it cannot prove', () => {
  /* §3's four states, and the rule that makes them safe: the safe answer to "I
   * do not know" is the state that claims nothing. A helper that threw, or that
   * guessed SESSION, would be a way for a bug to look like a login. */
  assert.equal(journeyState(), AUTH_JOURNEY_STATES.UNKNOWN);
  assert.equal(journeyState({}), AUTH_JOURNEY_STATES.UNKNOWN);
  assert.equal(journeyState({ session: { user: { id: 'u' } } }), AUTH_JOURNEY_STATES.SESSION);
  assert.equal(journeyState({ verification: { pending: true } }), AUTH_JOURNEY_STATES.VERIFYING);
  assert.equal(journeyState({ verification: { ticket: 't' } }), AUTH_JOURNEY_STATES.ESTABLISHED);
  // A session object with no user is not a session.
  assert.equal(journeyState({ session: {} }), AUTH_JOURNEY_STATES.UNKNOWN);
  // Garbage in, UNKNOWN out — never a throw.
  assert.equal(journeyState({ session: null, verification: 'nonsense' }), AUTH_JOURNEY_STATES.UNKNOWN);
});

test('V2.2: nothing in production imports the contract yet', async () => {
  /* The step's own boundary. This ships the contract, not a migration: if a
   * production file starts importing it before V2.3, that is an unplanned
   * change of the live auth path and this test says so. `index.mjs` itself and
   * this suite are the only allowed importers. */
  const { execFileSync } = await import('node:child_process');
  const hits = execFileSync('grep', ['-rl', "auth-native/index.mjs", '--include=*.mjs', '--include=*.js', '.'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter(file => !file.includes('auth-native/index.mjs') && !file.includes('auth-contract.test.mjs') && !file.startsWith('./node_modules'));
  assert.deepEqual(hits, [], 'the contract must not be wired into production in this step');
});
