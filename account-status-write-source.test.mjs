/* AUTH V2.4 (owner 2026-11-01): every authorisation check reads the status that
 * is written — the rest of finding ১৪.
 *
 * The V2.1 fix corrected ONE read: the session lookup. Nine other guards across
 * the same repository still compared `auth_users.status`, a column that is set
 * once at INSERT, always to 'active', and never updated by anything. Suspension
 * is written to `auth_account_state`. So every one of those guards was
 * decorative: it could not refuse anybody.
 *
 * The reason this was not merely cosmetic is the revocation path. Suspension
 * revokes live sessions, so most reads had nothing left to refuse — which is
 * exactly why the dead guards went unnoticed. But a session MINTED AFTER the
 * suspension was never revoked, and it was minted by code that also read the
 * dead column. That is a complete bypass with no compensating control:
 *
 *   1. the student starts the ownership verification (ticket created)
 *   2. an admin suspends the account while the ticket is live
 *   3. the student finishes the OTP — `completeFirebaseAccountVerification`
 *      read `u.status`, saw 'active', and inserted a session
 *   4. nothing revoked it, because the suspension had already happened
 *   5. `getSession` — the one guard V2.1 fixed — also read the dead column, so
 *      the session was fully usable
 *
 * The first test below is that exact sequence against real SQLite. The rest
 * cover the other entry points the same way, and the last one pins the rule at
 * the source level so a new query cannot quietly reintroduce a bare read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import Database from 'better-sqlite3';

import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const START = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const fixture = () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const storage = {
    sql: {
      exec(statement, ...bindings) {
        const prepared = database.prepare(statement);
        if (prepared.reader) return prepared.all(...bindings);
        prepared.run(...bindings);
        return [];
      }
    },
    transactionSync(work) { return database.transaction(work)(); }
  };
  const repository = new SqliteAuthRepository(storage);
  repository.migrate();
  return { repository, database };
};

const establish = (repository, overrides = {}) => repository.establishExternalSession({
  provider: 'firebase', subjectRef: 'sub-1', emailRef: 'email-ref-1', emailMask: 's***@example.com',
  userIdCandidate: 'usr_write_1', sessionRef: 'session-ref-1', sessionExpiresAt: START + 30 * DAY,
  ipRef: 'ip-ref', deviceRef: 'device-ref', userAgent: 'Chrome', now: START, ...overrides
});

/* The ticket a student gets when they start the ownership verification. Created
 * while the account is still active, which is the ordinary case. */
const beginTicket = (repository, now = START + 1000) => repository.beginFirebaseAccountVerification({
  subjectRef: 'sub-1', emailRef: 'email-ref-1', emailMask: 's***@example.com',
  userIdCandidate: 'usr_write_1', ticketRef: 'ticket-ref-1', refreshCipher: 'cipher',
  purpose: 'signup', expiresAt: now + 10 * 60 * 1000, ipRef: 'ip-ref', deviceRef: 'device-ref',
  limits: [], now
});

test('V2.4-১৪: an account suspended mid-verification cannot mint a session', async () => {
  /* The bypass, end to end. Nothing here forces a session back to life — the
   * session is created after the suspension by code that read the dead column.
   * If the check reads the written status, the completion is refused. */
  const { repository, database } = fixture();
  await establish(repository);
  assert.equal((await beginTicket(repository)).prepared, true, 'the ticket exists, as it does for every signup');

  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'suspended', now: START + 2000 });

  const completed = await repository.completeFirebaseAccountVerification({
    ticketRef: 'ticket-ref-1', deviceRef: 'device-ref', subjectRef: 'sub-1', emailRef: 'email-ref-1',
    sessionRef: 'session-ref-2', sessionExpiresAt: START + 30 * DAY,
    ipRef: 'ip-ref', userAgent: 'Chrome', now: START + 3000
  });
  assert.equal(completed.established, undefined, 'a suspended account must not complete verification');
  assert.equal(completed.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED, 'and must say why');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_at IS NULL').get().n, 0,
    'no live session may exist for a suspended account');
  database.close();
});

test('V2.4-১৪: the session a suspension did not revoke is still refused', async () => {
  /* The V2.1 guard, re-proved against the repository as it stands now. A session
   * minted before the suspension is forced back to life so the STATUS CHECK is
   * isolated from the revocation that normally covers for it. */
  const { repository, database } = fixture();
  await establish(repository);
  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'suspended', now: START + 2000 });
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();

  for (const read of [
    () => repository.getSession({ sessionRef: 'session-ref-1', now: START + 3000 }),
    () => repository.getExternalSession({
      sessionRef: 'session-ref-1', provider: 'firebase', subjectRef: 'sub-1', emailRef: 'email-ref-1', now: START + 3000
    })
  ]) {
    const result = await read();
    assert.equal(result.user, undefined, 'a suspended account must not be usable');
    assert.equal(result.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED, 'and must say why');
  }
  database.close();
});

test('V2.4-১৪: the profile and passkey surfaces refuse a suspended account', async () => {
  /* The same dead column guarded the student-facing reads and writes. Every one
   * of them authorises through one query, so a session forced back to life is
   * the cheapest way to ask each of them directly. */
  const { repository, database } = fixture();
  await establish(repository);
  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'suspended', now: START + 2000 });
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();

  const sessionInput = {
    sessionRef: 'session-ref-1', subjectRef: 'sub-1', emailRef: 'email-ref-1', now: START + 3000
  };
  const calls = {
    getProfile: () => repository.getProfile(sessionInput),
    saveProfile: () => repository.saveProfile({ ...sessionInput, profile: { fullName: 'A Student' } }),
    saveProfilePatch: () => repository.saveProfilePatch({ ...sessionInput, fields: { bio: 'hello' } }),
    beginPasskeyRegistration: () => repository.beginPasskeyRegistration({ ...sessionInput, rpId: 'admissionsky.pages.dev' }),
    getPasskeyStatus: () => repository.getPasskeyStatus(sessionInput)
  };
  for (const [name, call] of Object.entries(calls)) {
    const result = await call();
    assert.equal(result.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED, `${name} must refuse a suspended account`);
  }
  database.close();
});

test('V2.4-১৪: the identity lookup still resolves, and reports the suspended status', async () => {
  /* `getFirebaseIdentity` is a LOOKUP, not an authorisation check, and the
   * difference is load-bearing. `#loginRiskDecision` calls it to learn who is
   * signing in, then reads the account state itself and turns a suspension into
   * a CRITICAL block. If the lookup refused instead, it would return no `user`,
   * the risk path's `if (identity.user)` guard would skip, and the suspension
   * would be silently dropped — a suspended student let in unchallenged. The
   * regression was real and `device-trust-step6` A6-৫ caught it while this
   * change was being written; this test keeps it caught.
   *
   * What must change is the STATUS the lookup reports, not whether it answers. */
  const { repository, database } = fixture();
  await establish(repository);
  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'suspended', now: START + 2000 });

  const identity = await repository.getFirebaseIdentity({ subjectRef: 'sub-1', emailRef: 'email-ref-1' });
  assert.equal(identity.error, undefined, 'the lookup must still answer, or the risk signal is lost');
  assert.ok(identity.user, 'and must name the user');
  assert.equal(identity.user.status, 'suspended', 'while reporting the status that is actually written');
  database.close();
});

test('V2.4-১৪: re-enabling the account restores every one of those surfaces', async () => {
  /* The guard must track the status, not latch it. Support clears a false alarm
   * and the student has to be able to use their account again — if the fix
   * refused a re-enabled account, it would be a worse bug than the one it
   * repairs. */
  const { repository, database } = fixture();
  await establish(repository);
  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'suspended', now: START + 2000 });
  await repository.setAccountState({ userId: 'usr_write_1', toStatus: 'active', now: START + 2500 });
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();

  const profile = await repository.getProfile({
    sessionRef: 'session-ref-1', subjectRef: 'sub-1', emailRef: 'email-ref-1', now: START + 3000
  });
  assert.equal(profile.error, undefined, 'a re-enabled account can read its profile again');
  assert.ok('profile' in profile, 'and reaches the profile read rather than a refusal');
  database.close();
});

test('V2.4-১৪: an account with no state row is still active, not refused', async () => {
  /* Every student who has never been suspended has no row in
   * `auth_account_state`. The COALESCE default has to match getAccountState's
   * own, or this fix would lock out every normal student — a far worse bug than
   * the decorative guard it replaces. */
  const { repository, database } = fixture();
  await establish(repository);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_account_state').get().n, 0,
    'the fixture has no state row, like a real unsuspended student');

  const profile = await repository.getProfile({
    sessionRef: 'session-ref-1', subjectRef: 'sub-1', emailRef: 'email-ref-1', now: START + 3000
  });
  assert.equal(profile.error, undefined, 'the ordinary student is unaffected');
  assert.ok('profile' in profile, 'and reaches the profile read');
  database.close();
});

test('V2.4-১৪: the in-memory double enforces the same rule as the real repository', async () => {
  /* Every one of these suites runs against the double, so a fix that lived only
   * in the SQLite repository would pass its own tests and change nothing in
   * production. This drives the double through the engine, which is how the
   * tests above reach it. */
  const repository = new MemoryAuthRepository();
  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: 'write-source-secret-0123456789-ABCDEFG', now: () => now });
  const context = {
    ip: '203.0.113.9', deviceId: 'device-write-source-0123456789',
    userAgent: 'Mozilla/5.0 Chrome/140', origin: 'https://admissionsky.pages.dev'
  };
  const session = await engine.establishFirebaseSession(
    { email: 'write@example.com', subject: 'uid-write', verified: true, newDevice: true, securityChallenge: false },
    context
  );
  const user = [...repository.users.values()][0];
  now += 1000;
  await repository.setAccountState({ userId: user.id, toStatus: 'suspended', now });
  for (const live of repository.sessions.values()) live.revokedAt = null;

  const read = await repository.getSession({ sessionRef: [...repository.sessions.keys()][0], now: now + 1000 });
  assert.equal(read.user, undefined, 'the double must refuse a suspended account too');
  assert.equal(read.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED);
  assert.ok(session.sessionToken, 'the session was real before the suspension');
});

/* Every production .mjs under auth-native, excluding the doubles and the ops
 * scripts — the same scope `native-auth-protection` uses for its runtime scan,
 * so the two agree on what counts as shipped code. */
function walkProduction(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkProduction(full)); continue; }
    if (!full.endsWith('.mjs')) continue;
    if (full.includes('/testing/') || full.includes('/operations/')) continue;
    out.push(full);
  }
  return out;
}

/* A comment is not code. The note explaining this rule quotes the very query it
 * forbids, so a scan that cannot tell prose from code would flag its own
 * documentation — and the first version of this test did exactly that. */
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('V2.4-১৪: no authorisation query reads the never-written column on its own', async () => {
  /* The rule at the source level, and the only assertion here that can see an
   * absence. A behavioural test cannot notice a NEW query that reintroduces the
   * bare read until someone constructs the scenario again — which is how this
   * one was missed for as long as it was. Every status a guard compares must be
   * the COALESCE'd alias, or the status column of a different table. */
  /* REPO-WIDE, not one file. The first version of this scan read only
   * `sqlite-auth-repository.mjs`, and that scope is exactly why the same bug was
   * found three separate times: `identitySnapshot` (same file, different shape),
   * the public-profile query, and finally `studentCounts` in
   * `student-admin-view.mjs` — a file the scan never opened. A rule enforced on
   * one file is a rule the next file silently opts out of. */
  const files = walkProduction(new URL('./auth-native/', import.meta.url).pathname);
  const offenders = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    // Every SELECT that touches auth_users. If it projects a `status` and does
    // not also name the account-state table, the status it reads is the column
    // nothing writes.
    for (const match of source.matchAll(/[`'"]([^`'"]*\bSELECT\b[^`'"]*\bauth_users\b[^`'"]*)[`'"]/gis)) {
      const query = match[1];
      if (query.includes('auth_account_state')) continue;
      if (!/(?:^|[\s,(])(?:u\.)?status(?![\w.])/i.test(query)) continue;
      /* One allowance, and it has to be exact: a query chosen by a ternary on
       * `has(sql, 'auth_account_state')`, where the false branch is the whole
       * query. There the raw column is genuinely the only status the database
       * has, so reading it is correct rather than a guard that cannot fire.
       *
       * "Exact" is doing real work here. The first version looked back a fixed
       * distance for the `has(...)` call, and a planted dead-column read 40
       * lines earlier was waved through because an unrelated query's own
       * `has(...)` happened to fall inside the window. The check now requires
       * the call to be the ternary condition immediately preceding this query,
       * which is a shape a stray match cannot imitate. */
      const before = source.slice(Math.max(0, match.index - 600), match.index);
      /* The shape: `has(sql, 'auth_account_state') ? <joined query> : <this
       * query>`. So this query is allowed when it is the FALSE branch — the
       * text before it ends at a `:` — and the same ternary's condition is in
       * the window. Both halves are required, so an unrelated `has(...)` cannot
       * vouch for a query that is not its own false branch. (The first attempt
       * tried to match `? ... query` in one regex; the joined query contains a
       * `?` placeholder, which broke it.) */
      if (/[:]\s*$/.test(before) && /has\(\s*sql\s*,\s*['"]auth_account_state['"]\s*\)/.test(before)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${relative(new URL('./', import.meta.url).pathname, file)}:${line}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these queries read auth_users.status without joining auth_account_state — that column is written once at INSERT and never updated, so the read can never see a suspension. Use COALESCE(st.status,u.status).');

  // And the fix is present, so this cannot pass by the queries having vanished.
  const repository = readFileSync(new URL('./auth-native/storage/sqlite-auth-repository.mjs', import.meta.url), 'utf8');
  assert.match(repository, /COALESCE\(st\.status,u\.status\) AS status/, 'the written status is read');
  assert.match(repository, /LEFT JOIN auth_account_state st ON st\.user_id=u\.user_id/, 'and the state table is joined');

  /* The scan has to prove it is still LOOKING, not merely finding nothing.
   *
   * This is the flaw that cost the most today: the previous version of this
   * scan read one file, reported no offenders, and was believed — while three
   * reads of the dead column sat in files it never opened. "Passing" and
   * "working" are different claims, and only the second one is worth anything.
   *
   * So: the walk must reach a plausible number of files, and the query pattern
   * must still match the queries that are known to be there. If either silently
   * stops working — a path changes, a regex stops matching a refactor — this
   * fails instead of going quiet. */
  assert.ok(files.length >= 20,
    `the scan only reached ${files.length} files; if the layout moved, fix the walk rather than letting the scan go quiet`);
  const scanned = files.reduce((n, file) => {
    const source = stripComments(readFileSync(file, 'utf8'));
    return n + [...source.matchAll(/[`'"]([^`'"]*\bSELECT\b[^`'"]*\bauth_users\b[^`'"]*)[`'"]/gis)].length;
  }, 0);
  assert.ok(scanned >= 20,
    `the scan found only ${scanned} auth_users queries across ${files.length} files; the pattern has stopped matching the code it is meant to read`);
});

test('V2.4-১৪: the reconciliation health check is shown the status that can be wrong', async () => {
  /* `identitySnapshot` feeds `reconcileIdentitySnapshot`, which reports a user
   * whose status is outside the canonical set as `invalid-user-status`. Reading
   * the raw column made that finding vacuous — the column is written once at
   * INSERT, always to 'active', so it can never hold an invalid value and the
   * health check could only ever be green. A suspended account was reported as
   * 'active', which is the one thing the check exists to notice.
   *
   * Asserted through the double because that is what every suite runs against,
   * and asserted at all because the gap survived the first pass over this
   * finding: the guards were enumerated one at a time and this read is not a
   * guard, so it was not on the list. */
  const repository = new MemoryAuthRepository();
  const now = START;
  await repository.establishExternalSession({
    provider: 'firebase', subjectRef: 'sub-snapshot', emailRef: 'email-ref-snapshot',
    emailMask: 's***@example.com', userIdCandidate: 'usr_snapshot', sessionRef: 'session-ref-snapshot',
    sessionExpiresAt: now + 30 * 24 * 60 * 60 * 1000, ipRef: 'ip-ref', deviceRef: 'device-ref',
    userAgent: 'Chrome', now
  });
  const user = [...repository.users.values()][0];
  await repository.setAccountState({ userId: user.id, toStatus: 'suspended', now: now + 1000 });

  const snapshot = await repository.identitySnapshot();
  assert.equal(snapshot.users[0].status, 'suspended',
    'the snapshot must carry the status that is written, or the reconciliation can never see a wrong one');
});

test('V2.4-১৪: the public-profile query does not lean on the constant column', async () => {
  /* The one query that carried the dead column as a WHERE clause rather than a
   * guard: `u.status='active' AND COALESCE(st.status,'active')='active'`. The
   * first half is a constant — true for every row ever inserted — so it read
   * like a second, independent check while narrowing nothing. The account-state
   * clause is the one that decides, and it is the one that should be read. */
  const raw = readFileSync(new URL('./auth-native/storage/sqlite-auth-repository.mjs', import.meta.url), 'utf8');
  // Comments are stripped first: the note explaining why the clause was removed
  // quotes it, and a check that cannot tell prose from code is not a check.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /u\.status\s*=\s*'active'/,
    "a query filters on the constant column — it can never narrow anything; compare COALESCE(st.status,u.status) instead");
});
