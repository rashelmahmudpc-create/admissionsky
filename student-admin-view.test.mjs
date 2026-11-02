// Fresh Start phase 3: Control Center Students (read-only admin view).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { SqliteVerificationRepository } from './auth-native/verification/sqlite-verification-repository.mjs';
import { migrateStudentDirectory } from './auth-native/storage/student-directory-schema.mjs';
import { AuthHmac, normalizeAuthEmail } from './auth-native/core/crypto.mjs';
import { listStudents, studentCounts, studentProfile, STUDENT_LIST_MAX } from './auth-native/storage/student-admin-view.mjs';

const SECRET = 'student-admin-view-secret-0123456789-ABCDEFGHIJKLMNOP';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const SECRETS = ['CODE-MAC-SECRET', 'CODE-CIPHER-SECRET', 'LINK-MAC-SECRET', 'REFRESH-CIPHER-SECRET', 'PUBLIC-KEY-SECRET',
  'IP-REF-SECRET', 'Mozilla/5.0 (Windows NT 10.0) FULL-UA-SECRET', 'SESSIONREF-SECRET-0000', 'EMAIL-REF-SECRET', '01712345678'];

function fixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  const storage = { sql, transactionSync(work) { return database.transaction(work)(); } };
  new SqliteAuthRepository(storage).migrate();
  new SqliteVerificationRepository(storage).migrate();
  migrateStudentDirectory(storage, { now: NOW });
  return { sql, storage };
}

async function seed(sql) {
  const hmac = new AuthHmac(SECRET);
  const refA = await hmac.hex('email-ref-v1', normalizeAuthEmail('Rashel+Test@Gmail.com'));
  sql.exec('INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)', 'u-alpha', refA, 'ra***@gmail.com', 'active', NOW - 10 * DAY, NOW - DAY);
  sql.exec('INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)', 'u-beta', 'EMAIL-REF-SECRET', 'be***@yahoo.com', 'disabled', NOW - 2 * 60 * 60 * 1000, NOW - 60 * 60 * 1000);
  sql.exec(`INSERT INTO auth_profiles(user_id,profile_version,full_name,date_of_birth,school_id,school_name,school_district,created_at,updated_at,mobile,subjects,targets)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, 'u-alpha', 1, 'Rahim Uddin', '2008-01-02', 's1', 'Dhaka College', 'Dhaka', NOW - 10 * DAY, NOW - 5 * DAY, '01712345678', '["Physics"]', '["BUET"]');
  sql.exec('INSERT INTO auth_external_identities(provider,subject_ref,user_id,created_at,last_verified_at) VALUES(?,?,?,?,?)', 'firebase', 'subj-a', 'u-alpha', NOW - 10 * DAY, NOW - DAY);
  sql.exec(`INSERT INTO auth_sessions(session_ref,user_id,created_at,expires_at,last_seen_at,revoked_at,ip_ref,device_ref,user_agent) VALUES(?,?,?,?,?,?,?,?,?)`,
    'SESSIONREF-SECRET-0000', 'u-alpha', NOW - DAY, NOW + DAY, NOW - 1000, null, 'IP-REF-SECRET', 'devref-alpha-1234567890', 'Mozilla/5.0 (Windows NT 10.0) FULL-UA-SECRET');
  sql.exec('INSERT INTO auth_trusted_devices(user_id,device_ref,browser_class,trusted_at,expires_at,revoked_at,policy_version) VALUES(?,?,?,?,?,?,?)', 'u-alpha', 'devref-alpha-1234567890', 'Windows · Chrome', NOW - DAY, NOW + 30 * DAY, null, 'p1');
  sql.exec('INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,?,?,?)', 'firebase-login', 'subj-a', 'u-alpha', NOW - DAY, 'devref-alpha-1234567890', null, 'p1');
  sql.exec(`INSERT INTO auth_verification_challenges(attempt_id,user_id,session_ref,subject_ref,email_ref,destination_ref,device_ref,ip_ref,purpose,code_mac,code_cipher,link_token_mac,link_cipher,
    provider_id,channel,verification_mode,state,attempts,max_attempts,created_at,expires_at,resend_at,sent_at,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'attempt-alpha-0001', 'u-alpha', 'SESSIONREF-SECRET-0000', 'subj-a', 'EMAIL-REF-SECRET', 'dest', 'devref-alpha-1234567890', 'IP-REF-SECRET', 'email-ownership',
    'CODE-MAC-SECRET', 'CODE-CIPHER-SECRET', 'LINK-MAC-SECRET', '', 'otp-a', 'email', 'otp', 'verified', 1, 5, NOW - 3 * DAY, NOW - 3 * DAY + 600000, NOW - 3 * DAY, NOW - 3 * DAY + 1000, NOW - 3 * DAY + 60000);
  sql.exec('INSERT INTO auth_verification_events(attempt_id,user_id,subject_ref,provider_id,channel,occurred_at,outcome,reason,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)', 'attempt-alpha-0001', 'u-alpha', 'subj-a', 'otp-a', 'email', NOW - 3 * DAY + 1000, 'sent', 'ACCEPTED', 420);
  sql.exec('INSERT INTO auth_email_ownership_links(user_id,subject_ref,email_ref,provider_id,method,status,proven_at,last_verified_at) VALUES(?,?,?,?,?,?,?,?)', 'u-alpha', 'subj-a', refA, 'otp-a', 'email-otp', 'active', NOW - 3 * DAY + 60000, NOW - 3 * DAY + 60000);
  sql.exec(`INSERT INTO auth_account_verification_tickets(ticket_ref,user_id,subject_ref,email_ref,refresh_cipher,state,purpose,created_at,expires_at,consumed_at,ip_ref,device_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    'ticket-1', 'u-alpha', 'subj-a', refA, 'REFRESH-CIPHER-SECRET', 'consumed', 'verify-email', NOW - 9 * DAY, NOW - 8 * DAY, NOW - 9 * DAY + 5000, 'IP-REF-SECRET', 'devref-alpha-1234567890');
  return { hmac, refA };
}

test('empty database: zero counts and an empty list', () => {
  const { sql } = fixture();
  assert.deepEqual(studentCounts(sql, { now: NOW }), { total: 0, active: 0, disabled: 0, suspended: 0, last24h: 0, last7d: 0 });
  const result = listStudents(sql, { now: NOW });
  assert.equal(result.entries.length, 0);
  assert.equal(result.nextBefore, null);
});

test('list is newest first with counts, masked email and login methods', async () => {
  const { sql } = fixture();
  await seed(sql);
  const result = listStudents(sql, { now: NOW });
  assert.equal(result.counts.total, 2);
  assert.equal(result.counts.active, 1);
  assert.equal(result.counts.disabled, 1);
  assert.equal(result.counts.last24h, 1);
  assert.equal(result.counts.last7d, 1);
  assert.deepEqual(result.entries.map(row => row.userId), ['u-beta', 'u-alpha']);
  const alpha = result.entries[1];
  assert.equal(alpha.emailMask, 'ra***@gmail.com');
  assert.equal(alpha.fullName, 'Rahim Uddin');
  assert.deepEqual(alpha.methods, ['firebase', 'email-otp']);
  assert.equal(result.entries[0].status, 'disabled');
});

test('search: exact email via the engine email ref, name substring, user id prefix', async () => {
  const { sql } = fixture();
  const { hmac } = await seed(sql);
  const ref = await hmac.hex('email-ref-v1', normalizeAuthEmail('  rashel+test@gmail.com '));
  assert.deepEqual(listStudents(sql, { emailRef: ref, now: NOW }).entries.map(row => row.userId), ['u-alpha']);
  assert.deepEqual(listStudents(sql, { emailRef: 'no-match', now: NOW }).entries, []);
  assert.deepEqual(listStudents(sql, { text: 'rahim', now: NOW }).entries.map(row => row.userId), ['u-alpha']);
  assert.deepEqual(listStudents(sql, { text: 'u-be', now: NOW }).entries.map(row => row.userId), ['u-beta']);
  assert.deepEqual(listStudents(sql, { text: '%', now: NOW }).entries, [], 'LIKE wildcards are escaped');
});

test('paging: limit is capped and the cursor walks to the next page', async () => {
  const { sql } = fixture();
  await seed(sql);
  const first = listStudents(sql, { limit: 1, now: NOW });
  assert.equal(first.entries.length, 1);
  assert.ok(first.nextBefore);
  const second = listStudents(sql, { limit: 1, before: first.nextBefore, now: NOW });
  assert.deepEqual(second.entries.map(row => row.userId), ['u-alpha']);
  assert.equal(listStudents(sql, { limit: 10_000, now: NOW }).entries.length, 2);
  assert.equal(STUDENT_LIST_MAX, 100);
});

test('profile has account, profile, login methods, email verification, OTP history, devices, sessions and timeline', async () => {
  const { sql } = fixture();
  await seed(sql);
  const student = studentProfile(sql, 'u-alpha', { now: NOW });
  assert.equal(student.account.userId, 'u-alpha');
  assert.equal(student.account.createdAt, NOW - 10 * DAY);
  assert.equal(student.profile.fullName, 'Rahim Uddin');
  assert.equal(student.profile.school.name, 'Dhaka College');
  assert.deepEqual(student.profile.subjects, ['Physics']);
  assert.equal(student.profile.mobileMasked, '•••678');
  assert.deepEqual(student.loginMethods.map(row => row.method), ['firebase']);
  assert.equal(student.emailVerification.otpOwnership.providerId, 'otp-a');
  assert.equal(student.emailVerification.firebaseLinks[0].state, 'consumed');
  assert.equal(student.otp.challenges[0].state, 'verified');
  assert.equal(student.otp.events[0].providerId, 'otp-a');
  assert.equal(student.devices[0].device, 'devref-a');
  assert.equal(student.devices[0].active, true);
  assert.equal(student.sessions.total, 1);
  assert.equal(student.sessions.active, 1);
  assert.equal(student.timeline[0].kind, 'firebase-login');
  assert.equal(student.timeline.at(-1).kind, 'account-created');
  assert.equal(studentProfile(sql, 'missing', { now: NOW }), null);
  assert.equal(studentProfile(sql, '', { now: NOW }), null);
});

test('no secret, code, cipher, token, IP ref, full user agent, email ref or raw mobile ever leaves the view', async () => {
  const { sql } = fixture();
  await seed(sql);
  const text = JSON.stringify([listStudents(sql, { now: NOW }), studentProfile(sql, 'u-alpha', { now: NOW }), studentProfile(sql, 'u-beta', { now: NOW })]);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, secret);
  assert.equal(text.includes('devref-alpha-1234567890'), false, 'device refs are shortened');
  assert.doesNotMatch(text, /code_mac|code_cipher|link_token_mac|refresh_cipher|public_key_jwk|ip_ref|email_ref/);
});

test('the view never writes', async () => {
  const { sql } = fixture();
  await seed(sql);
  const calls = [];
  const spy = { exec(statement, ...bindings) { calls.push(statement); return sql.exec(statement, ...bindings); } };
  listStudents(spy, { text: 'x', now: NOW });
  studentProfile(spy, 'u-alpha', { now: NOW });
  assert.ok(calls.length > 0);
  assert.deepEqual(calls.filter(statement => !/^\s*SELECT/i.test(statement)), []);
});

test('admin routes are token-gated, read-only and noindex', () => {
  const handler = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
  for (const route of ['admin/students`', 'admin/students/profile`']) {
    const start = handler.indexOf(route);
    assert.ok(start > 0, route);
    const block = handler.slice(start, start + 700);
    assert.match(block, /if \(!adminAuthorized\(request, env\)\) return json\(request, 403/);
    assert.ok(block.indexOf('adminAuthorized') < block.indexOf('callAuthority'));
    assert.match(block, /X-Robots-Tag': 'noindex, nofollow'/);
  }
  assert.match(handler, /request\.method === 'GET' && url\.pathname === `\$\{AUTH_API_PREFIX\}\/admin\/students`/);
  const authority = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
  assert.match(authority, /\/internal\/admin\/students\/list/);
  assert.match(authority, /\/internal\/admin\/students\/get/);
});

test('Students page: noindex, no storage, network-only in the service worker, CSP hashes match the inline code', () => {
  const page = readFileSync(new URL('./students-control-center.html', import.meta.url), 'utf8');
  const headers = readFileSync(new URL('./_headers', import.meta.url), 'utf8');
  const robots = readFileSync(new URL('./robots.txt', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  assert.match(page, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|console\./);
  assert.match(page, /X-AH-Admin-Token/);
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const style = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const hash = value => 'sha256-' + createHash('sha256').update(value).digest('base64');
  for (const path of ['/students-control-center\n', '/students-control-center.html\n']) {
    const start = headers.indexOf(path);
    assert.ok(start >= 0, path);
    const block = headers.slice(start, headers.indexOf('\n\n', start));
    assert.match(block, /Cache-Control: no-store/);
    assert.match(block, /X-Robots-Tag: noindex/);
    assert.match(block, /X-Frame-Options: DENY/);
    assert.ok(block.includes(`script-src '${hash(script)}'`), 'script hash');
    assert.ok(block.includes(`style-src '${hash(style)}'`), 'style hash');
    assert.doesNotMatch(block, /unsafe-inline/);
  }
  assert.match(robots, /Disallow: \/students-control-center/);
  assert.match(sw, /requestUrl\.pathname === '\/students-control-center'/);
});

test('V2.4-১৪: the dashboard counts the suspension that is written, not the column that is not', async () => {
  /* Found while sweeping the rest of finding ১৪, and it is the same shape as the
   * guards: `active` read the effective status, but `disabled` and `suspended`
   * beside it read `auth_users.status` — set once at INSERT, always to 'active',
   * never updated. Both figures were therefore structurally zero.
   *
   * The existing tests could not see it, and the reason is worth keeping: the
   * fixture above seeds `u-beta` with `status='disabled'` written straight into
   * `auth_users`, which is a row production never creates. The test was
   * asserting against its own fixture rather than against the system.
   *
   * So this seeds the way production does — suspension in `auth_account_state`,
   * with the user row left 'active' — and checks the numbers an operator reads. */
  const { sql } = fixture();
  await seed(sql);
  sql.exec("INSERT INTO auth_account_state(user_id,status,state_version,created_at,updated_at) VALUES(?,?,?,?,?)",
    'u-alpha', 'suspended', 1, NOW, NOW);

  const counts = studentCounts(sql, { now: NOW });
  assert.equal(counts.total, 2, 'both users are counted');
  assert.equal(counts.suspended, 1, 'the suspended student is reported as suspended');
  // The property that was silently broken: a suspended student was counted as
  // neither, so the figures did not add up to the total the dashboard also
  // prints. Asserted as a partition rather than against a fixed number, because
  // the fixture's other user is seeded as disabled and the point is the sum.
  assert.equal(counts.active + counts.disabled + counts.suspended, counts.total,
    'active + disabled + suspended must add up to the total, or the dashboard contradicts itself');
});
