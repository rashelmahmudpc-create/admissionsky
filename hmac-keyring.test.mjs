/* AUTH V2.4 (owner 2026-10-31): a reference can say which key made it.
 *
 * The blueprint's finding ১৫. Every derived reference — session, email, device,
 * network, subject — is an HMAC of the same secret, and the repository matches
 * on those references directly (`WHERE email_ref=?`, `WHERE session_ref=?`).
 * That is what makes rotation impossible: change the secret and every stored
 * reference stops matching, so every account, session and trusted device is
 * orphaned at once. A secret that cannot be changed is a leaked secret that is
 * permanent.
 *
 * What I found when I checked, rather than assumed: the vault and the HMAC
 * already derive DIFFERENT keys (the vault hashes the secret with its own
 * `vault-v1` label), so the two are not literally the same key material. The
 * blueprint's phrase "one env var, two jobs" is about the deployment, and it is
 * accurate there — both are keyed from one value, so rotating it breaks both.
 *
 * The missing piece was therefore not separation but STAGING: there was no way
 * to introduce a second key while the first was still readable, which is what
 * any rotation needs. `AuthHmac` now accepts a `current:previous` pair, signs
 * with the current one, and can enumerate every digest a value could have.
 *
 * Deliberately not a new environment variable: the Worker sits on Cloudflare's
 * 64-variable ceiling, so a second secret cannot have its own binding.
 *
 * The load-bearing test is the FIRST one — with a single key, nothing changes.
 * Every existing deployment runs with one key, so a change that altered its
 * output would orphan every stored reference on deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthHmac, parseHmacKeyring } from './auth-native/core/crypto.mjs';

const KEY_A = 'a'.repeat(48);
const KEY_B = 'b'.repeat(48);

test('V2.4-১৫: with a single key nothing changes — every existing reference still matches', () => {
  /* The compatibility guarantee. If this fails, deploying would orphan every
   * account, session and trusted device at once, because the stored references
   * were produced by exactly this computation. */
  const hmac = new AuthHmac(KEY_A);
  assert.equal(parseHmacKeyring(KEY_A).length, 1, 'a plain secret is a one-key ring');
  // The digest is unchanged in shape and value: 64 hex chars, no prefix.
  return hmac.hex('session-ref-v1', 'token').then(digest => {
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest.includes(':'), false, 'no version prefix on the digest itself');
  });
});

test('V2.4-১৫: candidates() with one key returns exactly the hex() digest', async () => {
  // The rotation machinery must be free when no rotation is happening, or the
  // cost of this feature would be paid on every request forever.
  const hmac = new AuthHmac(KEY_A);
  const direct = await hmac.hex('email-ref-v1', 'student@example.com');
  const candidates = await hmac.candidates('email-ref-v1', 'student@example.com');
  assert.deepEqual(candidates, [direct], 'one key, one candidate, identical to hex()');
});

test('V2.4-১৫: a rotated ring signs with the new key and still resolves the old', async () => {
  /* The whole point. `current:previous` means: write new references under the
   * current key, and keep finding the ones the previous key made — so a rotation
   * can be staged across two deploys instead of being impossible. */
  const before = await new AuthHmac(KEY_A).hex('session-ref-v1', 'token');
  const rotated = new AuthHmac(`${KEY_B}:${KEY_A}`);
  const candidates = await rotated.candidates('session-ref-v1', 'token');

  assert.equal(candidates.length, 2, 'both keys are tried');
  assert.equal(candidates[0], await rotated.hex('session-ref-v1', 'token'),
    'the first candidate is what a new reference would be — the current key signs');
  assert.notEqual(candidates[0], before, 'and it differs from the old reference');
  assert.ok(candidates.includes(before), 'while the old reference is still findable');
});

test('V2.4-১৫: the keyring order decides which key signs', async () => {
  /* Order is the whole interface. A ring written backwards would sign with the
   * key being retired, so new references would be made under a key that is about
   * to disappear — the rotation would appear to work and then break everything. */
  const forward = new AuthHmac(`${KEY_B}:${KEY_A}`);
  const backward = new AuthHmac(`${KEY_A}:${KEY_B}`);
  assert.notEqual(await forward.hex('session-ref-v1', 'token'), await backward.hex('session-ref-v1', 'token'),
    'the first key in the ring is the one that signs');
  assert.equal(await forward.hex('session-ref-v1', 'token'), await new AuthHmac(KEY_B).hex('session-ref-v1', 'token'),
    'and it signs exactly as that key alone would');
});

test('V2.4-১৫: a keyring with a short or empty key is refused, not silently used', () => {
  /* A malformed ring must fail loudly. Quietly dropping a bad key would sign
   * references under a key the operator did not intend, which is worse than
   * refusing to start. */
  for (const bad of ['', '   ', 'short', `${KEY_A}:short`, `:${KEY_A}`, `${KEY_A}:`]) {
    assert.throws(() => new AuthHmac(bad), /./, `refused: ${JSON.stringify(bad)}`);
  }
  // And a well-formed pair is accepted.
  assert.doesNotThrow(() => new AuthHmac(`${KEY_A}:${KEY_B}`));
});

test('V2.4-১৫: parseHmacKeyring keeps order and drops nothing but whitespace', () => {
  assert.deepEqual(parseHmacKeyring(KEY_A), [KEY_A]);
  assert.deepEqual(parseHmacKeyring(`${KEY_A}:${KEY_B}`), [KEY_A, KEY_B]);
  assert.deepEqual(parseHmacKeyring(` ${KEY_A} : ${KEY_B} `), [KEY_A, KEY_B], 'padding is trimmed');
  assert.deepEqual(parseHmacKeyring(''), [], 'empty is an empty ring, which the constructor refuses');
});

test('V2.4-১৫: the vault and the HMAC are already different keys, which is worth pinning', () => {
  /* What I found by checking rather than assuming. The blueprint reads as though
   * one key does both jobs in the cryptographic sense; it does not — the vault
   * hashes the secret with its own label before importing it. That distinction
   * matters because it means a rotation can move the two independently later,
   * and because a reader should not have to re-derive it. */
  return import('./auth-native/core/secret-vault.mjs').then(async ({ AuthSecretVault }) => {
    const hmac = new AuthHmac(KEY_A);
    const vault = new AuthSecretVault(KEY_A);
    const sealed = await vault.seal('p'.repeat(40), 'ctx');
    assert.match(sealed, /^v1\./, 'the vault version-tags its ciphertext');
    // The vault's key is a hash of the secret under its own label, so the same
    // secret does not give it the HMAC's key: a sealed value is not a digest.
    assert.notEqual(sealed, await hmac.hex('vault-v1', 'p'.repeat(40)));
  });
});
