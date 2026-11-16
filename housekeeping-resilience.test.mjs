/* AUTH V2.7 (owner 2026-11-16): a housekeeping failure must never fail a
 * student's request.
 *
 * The live bug: /internal/ping answered 200 while /login and /signup answered
 * 500 INTERNAL_ERROR. The mechanism, reproduced against the real Durable Object
 * class, is that #scheduleExpiry() ran unguarded in the request path. It arms
 * the cleanup alarm from three repositories' nextExpiry(); if ANY of them throws
 * — a housekeeping table missing, a column drifted by an older deploy — the
 * exception propagated out of fetch() and the whole request became a 500, for a
 * fault that had nothing to do with the student.
 *
 * This drives the real AdmissionAuthAuthority over a real SQLite database, drops
 * a table the housekeeping chain reads, and asserts the request still succeeds.
 * Before the fix this test fails with 500; after it, 200.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { AdmissionAuthAuthority } from './auth-native/worker/auth-authority-do.mjs';

const SECRET = 'sqlite-runtime-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* A Durable Object state stub backed by a real in-memory SQLite database. The
 * DO reads state.storage.sql for every query and state.storage for alarms, so
 * this is the same surface workerd provides. */
function stateFixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const kv = new Map();
  const alarms = { at: null };
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  const storage = {
    sql,
    transactionSync(work) { return database.transaction(work)(); },
    async get(key) { return kv.get(key); },
    async put(key, value) { kv.set(key, value); },
    async delete(key) { Array.isArray(key) ? key.forEach(k => kv.delete(k)) : kv.delete(key); },
    async list({ prefix } = {}) {
      const out = new Map();
      for (const [k, v] of kv) if (!prefix || String(k).startsWith(prefix)) out.set(k, v);
      return out;
    },
    async getAlarm() { return alarms.at; },
    async setAlarm(at) { alarms.at = at; }
  };
  const state = {
    storage,
    blockConcurrencyWhile(work) { return work(); },
    waitUntil() {}
  };
  return { database, state };
}

const env = {
  AUTH_HMAC_SECRET: SECRET,
  VERIFICATION_AUTH_ACTIVATION: 'enabled'
};

const post = (path, body) => new Request('https://auth.internal' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('V2.7: a housekeeping table missing does not fail the login request', async () => {
  const { database, state } = stateFixture();
  const authority = new AdmissionAuthAuthority(state, env);
  await authority.ready;

  // The drift the live deployment carried: a housekeeping table the alarm chain
  // reads is absent. Before the fix this made every non-ping route a 500.
  database.exec('DROP TABLE auth_security_challenges');

  const request = post('/internal/firebase/rate', {
    input: { operation: 'login', email: 'drift.probe@gmail.com' },
    context: { ip: '1.2.3.4', deviceId: 'dev-12345678901234567890' }
  });
  const response = await authority.fetch(request);
  const body = await response.json();

  assert.equal(response.status, 200,
    'a housekeeping fault must not become the student\'s 500: ' + JSON.stringify(body));
  assert.equal(body.ok, true, 'the rate operation still answers normally');
  database.close();
});

test('V2.7: ping stays 200 while housekeeping is broken (the live symptom)', async () => {
  const { database, state } = stateFixture();
  const authority = new AdmissionAuthAuthority(state, env);
  await authority.ready;
  database.exec('DROP TABLE auth_sessions');

  const ping = await authority.fetch(new Request('https://auth.internal/internal/ping'));
  assert.equal(ping.status, 200, 'ping returns before the housekeeping call, as it did live');

  const rate = await authority.fetch(post('/internal/firebase/rate', {
    input: { operation: 'signup', email: 'drift.signup@gmail.com' },
    context: { ip: '1.2.3.4', deviceId: 'dev-12345678901234567890' }
  }));
  assert.equal(rate.status, 200, 'and the real route no longer 500s on the same fault');
  database.close();
});

test('V2.7: a housekeeping failure is recorded, not swallowed', async () => {
  const { database, state } = stateFixture();
  const authority = new AdmissionAuthAuthority(state, env);
  await authority.ready;
  database.exec('DROP TABLE auth_security_challenges');

  await authority.fetch(post('/internal/firebase/rate', {
    input: { operation: 'login', email: 'record.probe@gmail.com' },
    context: { ip: '1.2.3.4', deviceId: 'dev-12345678901234567890' }
  }));

  assert.ok(authority.lastHousekeepingFailure,
    'the failure is visible to the owner rather than silently dropped');
  assert.match(String(authority.lastHousekeepingFailure.message), /auth_security_challenges/);
  database.close();
});
