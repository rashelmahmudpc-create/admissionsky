/* AUTH V2.0 (owner 2026-10-31): a half-open circuit must not stay half-open.
 *
 * A provider whose circuit opened is retried after its cooldown as a "probe":
 * the repository promotes open -> half-open, and the orchestrator sorts the
 * probe first so it is the one slot that actually gets tried. That is right —
 * something has to close the circuit.
 *
 * What was missing is the other half. `recordProviderResult` only ever changed
 * the circuit on success or on a HARD/THRESHOLD failure; a USER-class failure
 * counted an error and left the circuit alone. So a slot that kept answering
 * USER-class — a provider having a bad day with one destination, not a dead
 * one — stayed half-open forever. It was then sorted first on every single
 * request, and every request paid its full timeout before the healthy slots got
 * a turn. A permanent tax, paid for a provider that was merely answering oddly.
 *
 * Reopening it for another cooldown keeps both properties: the slot still gets
 * a fresh probe after the cooldown, so it can recover, and in the meantime it
 * stops being tried ahead of everyone else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_FAILURE_CLASS } from './auth-native/verification/provider-contract.mjs';

const NOW = 1_800_000_000_000;
const COOLDOWN_MS = 60_000;
const THRESHOLD = 3;

const setup = () => new MemoryVerificationRepository();

// One recorded result, with the shape the orchestrator's #record sends.
const record = (repository, { success = false, failureClass, reason = 'X', now = NOW } = {}) =>
  repository.recordProviderResult({
    providerId: 'otp-test',
    success,
    failureClass,
    reason,
    latencyMs: 5,
    failureThreshold: THRESHOLD,
    forceCooldown: false,
    cooldownMs: COOLDOWN_MS,
    now
  });

const circuitOf = (repository, now = NOW) =>
  repository.providerSnapshot({ providerId: 'otp-test', now }).then(row => row.circuit);

test('V2.0-১৬: a hard failure opens the circuit, and the cooldown makes it half-open', async () => {
  const repo = setup();
  await record(repo, { failureClass: VERIFICATION_FAILURE_CLASS.HARD });
  assert.equal(await circuitOf(repo), 'open', 'a dead provider is taken out');

  assert.equal(await circuitOf(repo, NOW + COOLDOWN_MS + 1), 'half-open',
    'and comes back as a probe once the cooldown passes');
});

test('V2.0-১৭: a USER-class answer to the probe reopens the circuit', async () => {
  const repo = setup();
  await record(repo, { failureClass: VERIFICATION_FAILURE_CLASS.HARD });
  await circuitOf(repo, NOW + COOLDOWN_MS + 1); // promote to half-open

  const after = await record(repo, {
    failureClass: VERIFICATION_FAILURE_CLASS.USER,
    reason: 'INVALID_DESTINATION',
    now: NOW + COOLDOWN_MS + 2
  });

  assert.equal(after.circuit, 'open', 'the probe did not close it, so it must not stay the probe');
  assert.ok(after.cooldownUntil > NOW + COOLDOWN_MS + 2, 'and it waits out another cooldown');
});

test('V2.0-১৮: the slot is no longer sorted as the probe on the next request', async () => {
  /* The consequence that actually costs the student time: the probe is tried
     first, so a stuck one delays every send. */
  const repo = setup();
  await record(repo, { failureClass: VERIFICATION_FAILURE_CLASS.HARD });
  await circuitOf(repo, NOW + COOLDOWN_MS + 1);
  await record(repo, {
    failureClass: VERIFICATION_FAILURE_CLASS.USER,
    reason: 'INVALID_DESTINATION',
    now: NOW + COOLDOWN_MS + 2
  });

  const next = await repo.providerSnapshot({ providerId: 'otp-test', now: NOW + COOLDOWN_MS + 3 });
  assert.notEqual(next.circuit, 'half-open', 'the orchestrator sorts on exactly this value');
});

test('V2.0-১৯: a USER-class failure on a closed circuit leaves it closed', async () => {
  /* The guard against over-reach. A provider that rejects one destination is
     not a broken provider, and a student typing a bad address must not take it
     out of the chain for everyone. */
  const repo = setup();
  const after = await record(repo, {
    failureClass: VERIFICATION_FAILURE_CLASS.USER,
    reason: 'INVALID_DESTINATION'
  });
  assert.equal(after.circuit, 'closed', 'an ordinary rejection must not open anything');
  assert.equal(after.userErrorCount, 1, 'but it is still counted');
  assert.equal(after.failureCount, 0, 'and it is not counted as a provider failure');
});

test('V2.0-২০: a success still closes the circuit from half-open', async () => {
  /* The whole point of probing. If reopening a probe that answers USER-class
     had broken the success path, the circuit could never close again. */
  const repo = setup();
  await record(repo, { failureClass: VERIFICATION_FAILURE_CLASS.HARD });
  await circuitOf(repo, NOW + COOLDOWN_MS + 1);
  const after = await record(repo, { success: true, reason: 'accepted', now: NOW + COOLDOWN_MS + 2 });
  assert.equal(after.circuit, 'closed', 'a working provider comes back for good');
  assert.equal(after.cooldownUntil, 0);
  assert.equal(after.consecutiveFailures, 0);
});

test('V2.0-২১: the SQLite repository carries the same rule as the memory double', async () => {
  /* These suites run against the memory double, so a fix that lived only there
     would look green and change nothing in production. */
  const source = readFileSync(new URL('./auth-native/verification/sqlite-verification-repository.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async recordProviderResult(');
  assert.ok(start > -1, "the repository still has recordProviderResult");
  const body = source.slice(start, source.indexOf('\n  async ', start + 10));
  assert.match(body, /next\.circuit === 'half-open'/,
    'the SQLite repository must reopen a half-open circuit that answers USER-class');
  assert.match(body, /VERIFICATION_FAILURE_CLASS\.USER/,
    'on the USER-class branch specifically');
});
