import test from 'node:test';
import assert from 'node:assert/strict';
import { createKvLoginFacts, createKvIpBreadth } from './auth-native/core/login-facts.mjs';
import { shadowVerdict } from './auth-native/core/shadow-guard.mjs';

const fakeStore = () => {
  const rows = new Map();
  return {
    rows,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async put(key, value) {
      rows.set(key, value);
    }
  };
};

test('a first sighting is not travel', async () => {
  const facts = createKvLoginFacts(fakeStore());
  const first = await facts.observe('student@example.com', { country: 'BD', asn: 12345 });
  assert.equal(first.first, true);
  assert.equal(first.countryChanged, false);
  assert.equal(first.asnChanged, false);
});

test('a second login from the same place reports no change', async () => {
  const facts = createKvLoginFacts(fakeStore());
  await facts.observe('student@example.com', { country: 'BD', asn: 12345 });
  const second = await facts.observe('student@example.com', { country: 'BD', asn: 12345 });
  assert.equal(second.known, true);
  assert.equal(second.countryChanged, false);
  assert.equal(second.asnChanged, false);
});

test('a change of country and network is reported', async () => {
  const facts = createKvLoginFacts(fakeStore());
  await facts.observe('student@example.com', { country: 'BD', asn: 12345 });
  const moved = await facts.observe('student@example.com', { country: 'RU', asn: 99999 });
  assert.equal(moved.countryChanged, true);
  assert.equal(moved.asnChanged, true);
});

test('a missing country never counts as a change', async () => {
  const facts = createKvLoginFacts(fakeStore());
  await facts.observe('student@example.com', { country: 'BD', asn: 12345 });
  const unknown = await facts.observe('student@example.com', { country: '', asn: undefined });
  assert.equal(unknown.known, false);
  assert.equal(unknown.countryChanged, false);
});

test('the stored key never contains the address', async () => {
  const store = fakeStore();
  const facts = createKvLoginFacts(store);
  await facts.observe('student@example.com', { country: 'BD', asn: 1 });
  const keys = [...store.rows.keys()];
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes('student'));
  assert.ok(!keys[0].includes('@'));
  assert.ok(keys[0].startsWith('acct-facts:'));
});

test('the stored value holds no readable address either', async () => {
  const store = fakeStore();
  await createKvLoginFacts(store).observe('student@example.com', { country: 'BD', asn: 1 });
  const value = [...store.rows.values()][0];
  assert.ok(!value.includes('student'));
  assert.ok(!value.includes('@'));
});

test('a broken store reports unknown rather than a change', async () => {
  const broken = {
    async get() {
      throw new Error('kv down');
    },
    async put() {
      throw new Error('kv down');
    }
  };
  const result = await createKvLoginFacts(broken).observe('student@example.com', { country: 'BD', asn: 1 });
  assert.equal(result.known, false);
  assert.equal(result.countryChanged, false);
});

test('without a store nothing is observed and nothing is claimed', async () => {
  const result = await createKvLoginFacts(null).observe('student@example.com', { country: 'BD', asn: 1 });
  assert.deepEqual(result, { first: false, known: false, countryChanged: false, asnChanged: false });
});

test('one address trying many accounts is counted', async () => {
  const store = fakeStore();
  const breadth = createKvIpBreadth(store);
  for (let i = 0; i < 12; i += 1) {
    await breadth.observe('203.0.113.9', `student${i}@example.com`);
  }
  const result = await breadth.observe('203.0.113.9', 'student12@example.com');
  assert.equal(result.emailsFromIp, 13);
});

test('the same account twice is not counted twice', async () => {
  const store = fakeStore();
  const breadth = createKvIpBreadth(store);
  await breadth.observe('203.0.113.9', 'student@example.com');
  const again = await breadth.observe('203.0.113.9', 'student@example.com');
  assert.equal(again.emailsFromIp, 1);
});

test('the breadth key hides the address', async () => {
  const store = fakeStore();
  await createKvIpBreadth(store).observe('203.0.113.9', 'student@example.com');
  const key = [...store.rows.keys()][0];
  assert.ok(!key.includes('203.0.113.9'));
  assert.ok(key.startsWith('ip-breadth:'));
});

test('a broken store does not read as zero accounts', async () => {
  const broken = {
    async get() {
      throw new Error('kv down');
    },
    async put() {
      throw new Error('kv down');
    }
  };
  const result = await createKvIpBreadth(broken).observe('203.0.113.9', 'student@example.com');
  assert.equal(result.known, false);
  assert.equal(result.emailsFromIp, 0);
});

// --- the facts actually reach the verdict -------------------------------------

test('the supplied facts can reach the high band the guard exists to enforce', () => {
  // Before this module the handler supplied only `deviceKnown`, so the high
  // band was unreachable and the shadow-ban never ran. These are the shapes
  // that must reach it.
  const travelled = shadowVerdict({ deviceKnown: false, countryChanged: true, asnChanged: true });
  assert.equal(travelled.shadowBan, true);

  const stuffing = shadowVerdict({ deviceKnown: true, emailsFromIp: 25, botScore: 5 });
  assert.equal(stuffing.shadowBan, true);
  assert.ok(stuffing.reasons.includes('many-emails-from-ip'));
  assert.ok(stuffing.reasons.includes('bot-suspicious'));
});

test('an ordinary returning student stays low with the new facts in place', () => {
  const verdict = shadowVerdict({ deviceKnown: true, failedLogins: 0, emailsFromIp: 1, botScore: 90 });
  assert.equal(verdict.band, 'low');
  assert.equal(verdict.shadowBan, false);
});

test('a student on a shared campus address stays low', () => {
  // A handful of students behind one address is normal; the threshold is ten.
  const verdict = shadowVerdict({ deviceKnown: true, emailsFromIp: 6, botScore: 88 });
  assert.equal(verdict.shadowBan, false);
});
