/* AUTH V2.4 (owner 2026-10-31): "delete all users" deletes the photos too.
 *
 * The blueprint's finding ১৬. The wipe emptied the Durable Object's SQLite —
 * every auth table — and stopped there. Avatars live in a different store
 * entirely (D1, the PROFILE_DB binding), so a wipe left every student's photo
 * behind: the accounts were gone and the pictures were not.
 *
 * That is the worst shape a deletion bug can take. The operator sees a wipe
 * succeed, the tables come back empty, and the one thing a student would
 * actually recognise — their own face — is still there.
 *
 * These tests drive the real D1 store against a fake D1 that records what it was
 * asked to do, so the assertion is about the statement that reached the database
 * rather than about a function existing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { D1ProfileStore } from './auth-native/storage/d1-profile-repository.mjs';

/* A D1 stand-in that records statements and answers COUNT. */
const fakeD1 = ({ rows = 3, failOn = null } = {}) => {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const record = { sql: String(sql).trim(), bindings: [] };
      statements.push(record);
      return {
        bind(...values) { record.bindings = values; return this; },
        async run() {
          if (failOn && record.sql.includes(failOn)) throw new Error('d1 unavailable');
          return { success: true };
        },
        async first() {
          if (failOn && record.sql.includes(failOn)) throw new Error('d1 unavailable');
          return record.sql.toUpperCase().includes('COUNT') ? { count: rows } : null;
        }
      };
    }
  };
};

test('V2.4-১৬: wiping all avatars deletes every row and reports how many', async () => {
  const d1 = fakeD1({ rows: 7 });
  const store = new D1ProfileStore(d1);
  const result = await store.wipeAllAvatars();
  assert.deepEqual(result, { deleted: 7, available: true });
  // The statement that matters: an unqualified DELETE, not a per-user one.
  const deletes = d1.statements.filter(record => /^DELETE FROM avatars$/i.test(record.sql));
  assert.equal(deletes.length, 1, 'exactly one bulk delete, with no WHERE clause');
});

test('V2.4-১৬: an unbound store reports unavailable rather than throwing', async () => {
  /* The binding is optional — absent until PROFILE_DB is added at publish time.
   * A wipe of the auth tables must still succeed on such a deployment, so this
   * is a value, not an exception. */
  const store = new D1ProfileStore(null);
  const result = await store.wipeAllAvatars();
  assert.deepEqual(result, { deleted: 0, available: false });
});

test('V2.4-১৬: a store that cannot be reached says so instead of reporting zero', async () => {
  /* "Nothing to delete" and "could not reach the store" must not look the same.
   * The second is a wipe that did not finish, and an operator has to see it. */
  const store = new D1ProfileStore(fakeD1({ failOn: 'COUNT' }));
  await assert.rejects(() => store.wipeAllAvatars(), /d1 unavailable/);
});

test('V2.4-১৬: the wipe route clears the avatars and reports them separately', async () => {
  /* Asserted on the source because the wipe route runs inside a Durable Object
   * with a real SQLite handle, which this suite has no way to stand up. What is
   * being pinned is the wiring: the route must call the avatar wipe, and must
   * report its outcome beside the table counts rather than folding it in. */
  const source = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
  assert.match(source, /wipeAllAvatars\(\)/, 'the wipe route reaches the avatar store');
  assert.match(source, /avatars, after: wipeCounts\(sql\)/, 'and reports it in the wipe result');
  // A failure to reach the store is caught and surfaced, not swallowed.
  assert.match(source, /avatars = \{ deleted: 0, available: true, error:/,
    'a wipe that could not finish must say so rather than report success');
  // And it must not break a deployment with no binding.
  assert.match(source, /typeof this\.engine\.avatarStore\?\.wipeAllAvatars === 'function'/,
    'the binding is optional, so the wipe must still succeed without it');
});

test('V2.4-১৬: the wipe still keeps the tables it always kept', async () => {
  /* The avatar wipe must not have disturbed the existing keep-list — a wipe that
   * started deleting operational tables would be a far worse bug than the one
   * being fixed. */
  const { WIPE_KEEP_TABLES } = await import('./auth-native/storage/student-wipe.mjs');
  assert.ok(WIPE_KEEP_TABLES.length > 0, 'there is a keep-list');
  const source = readFileSync(new URL('./auth-native/storage/student-wipe.mjs', import.meta.url), 'utf8');
  assert.match(source, /WIPE_KEEP_TABLES\.includes\(name\)/, 'and the wipe still honours it');
});
