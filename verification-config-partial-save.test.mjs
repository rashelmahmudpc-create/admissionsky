/* AUTH V2.0 (owner 2026-10-31): a config save must only change what it sent.
 *
 * Every provider slot is rebuilt from SLOT_DEFINITIONS on each save, and a slot
 * missing from the posted array came out `enabled: false`. The verification
 * control center posts one row per card it rendered, so a save from a panel
 * that rendered a shorter list — or any caller posting a subset — silently
 * disabled every slot it left out. The owner would have seen the OTP chain
 * shrink with nothing in the response to explain it, and the slots most likely
 * to be dropped are the ones added last, which are also the failover ones.
 *
 * The live config already carries a row per known slot, so "not sent" and "sent
 * as disabled" are distinguishable. These tests pin that: absent means
 * unchanged, explicit false still disables, and an explicit edit still lands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { verificationConfig, defaultVerificationConfig } from './auth-native/verification/config.mjs';

const enabledIds = config => config.providers.filter(row => row.enabled).map(row => row.id);
const byId = (config, id) => config.providers.find(row => row.id === id);

// A live config with a few slots switched on, the way the chain actually runs.
const live = () => {
  const base = defaultVerificationConfig();
  return verificationConfig({
    enabled: true,
    providers: base.providers.map(row => ({ id: row.id, enabled: row.id.startsWith('otp-'), priority: row.priority }))
  });
};

test('V2.0-১১: a save that omits a slot leaves that slot as it was', () => {
  const current = live();
  const before = enabledIds(current);
  assert.ok(before.length > 1, 'the fixture has a chain to protect');

  // The panel renders two cards and posts only those.
  const [first, second] = current.providers.slice(0, 2);
  const next = verificationConfig({
    providers: [
      { id: first.id, enabled: false, priority: first.priority },
      { id: second.id, enabled: true, priority: second.priority }
    ]
  }, current);

  const after = enabledIds(next);
  assert.equal(after.includes(first.id), false, 'the slot sent as disabled is disabled');
  const untouched = before.filter(id => id !== first.id);
  for (const id of untouched) {
    assert.ok(after.includes(id), `${id} was not sent, so it must keep running`);
  }
  assert.equal(after.length, before.length - 1, 'exactly one slot changed state');
});

test('V2.0-১২: without the current config the old behaviour is unchanged', () => {
  /* The base is optional so the constructor path (and every existing caller)
     keeps building a fresh config from scratch. Only a save against a live
     config is allowed to inherit. */
  const next = verificationConfig({ providers: [{ id: 'otp-a', enabled: true, priority: 10 }] });
  assert.deepEqual(enabledIds(next), ['otp-a'], 'a slot not mentioned is off when there is no base');
});

test('V2.0-১৩: an explicit edit still lands on an inherited slot', () => {
  const current = live();
  const target = current.providers[3];
  const next = verificationConfig({
    providers: [{ id: target.id, enabled: true, priority: 7, dailyQuota: 1234 }]
  }, current);

  const row = byId(next, target.id);
  assert.equal(row.priority, 7, 'the new priority is used');
  assert.equal(row.dailyQuota, 1234, 'and the new quota');
  assert.equal(row.enabled, true);
});

test('V2.0-১৪: an explicit false still disables, even against a live config', () => {
  /* The guard against over-reach. "Not sent" inherits; "sent as false" must
     still switch a provider off, or the panel could no longer take a bad
     sender out of the chain. */
  const current = live();
  const on = enabledIds(current)[0];
  const next = verificationConfig({ providers: [{ id: on, enabled: false }] }, current);
  assert.equal(enabledIds(next).includes(on), false, 'a deliberate disable must still work');
});

test('V2.0-১৫: an empty provider list changes nothing', () => {
  /* The strongest form of the bug: a save that mentions no slots at all used to
     turn the whole chain off. */
  const current = live();
  const next = verificationConfig({ providers: [] }, current);
  assert.deepEqual(enabledIds(next), enabledIds(current), 'the chain is untouched');
});
