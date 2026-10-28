import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { telegramLoginAccountFor } from './auth-native/worker/public-auth-handler.mjs';
import { telegramLoginCredentials, TELEGRAM_LOGIN_DOMAIN } from './auth-native/verification/telegram-login.mjs';

// F-04: the auth surface moves to its own Worker, but AUTH_HMAC_SECRET cannot go
// with it — a Cloudflare secret is write-only, and re-issuing it would change
// every derived Telegram address and orphan those accounts. So the split-out
// Worker asks the authority, which kept the secret.
//
// What this must prove: a student who signed in with "Continue with Telegram"
// still has a session after the split, and the extra round trip is *only* paid
// for addresses in the reserved Telegram domain.
const SECRET = 'a'.repeat(48);
const AUTHORITY = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');

const authorityStub = (answer, calls) => ({
  idFromName: name => name,
  get: () => ({
    // callAuthority passes a URL string plus an init object, not a Request.
    fetch: async (request, init = {}) => {
      const url = new URL(typeof request === 'string' ? request : request.url);
      calls.push(url.pathname);
      const body = JSON.parse(String(init.body || '{}'));
      return Response.json({ ok: true, result: { loginAccount: answer(body.email) } });
    }
  })
});

const telegramAccount = async () => (await telegramLoginCredentials('777001', { AUTH_HMAC_SECRET: SECRET })).email;

test('an address that is NOT a Telegram login never costs an authority round trip', async () => {
  const calls = [];
  const proven = await telegramLoginAccountFor({
    env: { AUTH_AUTHORITY: authorityStub(() => { throw new Error('must not be asked'); }, calls) },
    email: 'student@gmail.com'
  });
  assert.equal(proven, false);
  assert.deepEqual(calls, [], 'a normal student address is decided by a string compare');
});

test('without the local secret, the authority still recognises a Telegram account', async () => {
  const email = await telegramAccount();
  const calls = [];
  // admission-auth has no AUTH_HMAC_SECRET: this is the state after the split.
  const proven = await telegramLoginAccountFor({
    env: { AUTH_AUTHORITY: authorityStub(address => address === email, calls) },
    email
  });
  assert.equal(proven, true, 'the session survives the split');
  assert.deepEqual(calls, ['/internal/telegram/login-email']);
});

test('with the local secret, the in-process answer is trusted and nothing is asked', async () => {
  const email = await telegramAccount();
  const calls = [];
  const proven = await telegramLoginAccountFor({
    env: {
      AUTH_HMAC_SECRET: SECRET,
      AUTH_AUTHORITY: authorityStub(() => { throw new Error('must not be asked'); }, calls)
    },
    email
  });
  assert.equal(proven, true);
  assert.deepEqual(calls, [], 'admission-gk answers locally, exactly as it does today');
});

test('a wrong derived address is not accepted through the authority either', async () => {
  const email = `tg777001.${'0'.repeat(20)}@${TELEGRAM_LOGIN_DOMAIN}`;
  const proven = await telegramLoginAccountFor({
    env: { AUTH_AUTHORITY: authorityStub(() => false, []) },
    email
  });
  assert.equal(proven, false);
});

test('a failed authority call is a no, never an exception on the login path', async () => {
  const email = await telegramAccount();
  const proven = await telegramLoginAccountFor({
    env: { AUTH_AUTHORITY: { idFromName: n => n, get: () => ({ fetch: async () => { throw new Error('authority down'); } }) } },
    email
  });
  assert.equal(proven, false);
});

test('the authority route exists and derives with its own environment', () => {
  assert.match(AUTHORITY, /url\.pathname === '\/internal\/telegram\/login-email'/);
  assert.match(AUTHORITY, /isTelegramLoginEmail\(email, this\.env\)/,
    'the derivation runs where the secret is, not in the caller');
  assert.match(AUTHORITY, /email\.endsWith\(`@\$\{TELEGRAM_LOGIN_DOMAIN\}`\)/,
    'only the reserved domain is accepted');
});
