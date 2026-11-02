import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelegramCompletionMessage,
  notifyTelegramFromEnvironment,
  sendTelegramNotification
} from './email-gateway/operations/telegram-notifier.mjs';
import { runTelegramNotificationCli } from './email-gateway/operations/notify-telegram.mjs';

const token = () => ['123456789', 'A'.repeat(40)].join(':');
const chatId = '-1001234567890';

test('Telegram completion schema is bounded, plain-text and status controlled', () => {
  const message = createTelegramCompletionMessage({
    status: 'VERIFIED',
    summary: 'Phase verification completed.',
    details: ['84/84 email tests', 'No fake deployment'],
    timestamp: '2026-09-09T12:00:00.000Z'
  });
  assert.match(message, /^🔥 AdmissionSky\nStatus: VERIFIED/);
  assert.match(message, /84\/84 email tests/);
  assert.ok(message.length <= 4096);
  assert.throws(() => createTelegramCompletionMessage({ status: 'UNKNOWN', summary: 'nope' }), error => error.code === 'INVALID_NOTIFICATION');
});

test('Telegram notifier requires secret-safe bot and destination bindings without making a request', async () => {
  let calls = 0;
  await assert.rejects(notifyTelegramFromEnvironment({ env: {}, notification: { status: 'BLOCKED', summary: 'Configuration missing.' }, fetchImpl: async () => { calls += 1; } }), error => error.code === 'REQUIRED_SECRET_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('Telegram notifier sends one bounded request and requires acceptance evidence', async () => {
  const captures = [];
  const result = await sendTelegramNotification({
    token: token(), chatId,
    message: { status: 'COMPLETED', summary: 'Admission Sky task completed.', details: ['Tests passed'] },
    fetchImpl: async (url, init) => {
      captures.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  assert.deepEqual(result, { sent: true, messageId: 42 });
  assert.equal(captures.length, 1);
  assert.match(captures[0].url, /^https:\/\/api\.telegram\.org\/bot/);
  assert.equal(captures[0].init.method, 'POST');
  assert.equal(captures[0].body.chat_id, chatId);
  assert.equal(captures[0].body.protect_content, true);
  assert.equal(captures[0].body.text.includes(token()), false);
});

test('Telegram provider failures are redacted and malformed success is rejected', async () => {
  const privateToken = token();
  await assert.rejects(sendTelegramNotification({ token: privateToken, chatId, message: 'Safe message', fetchImpl: async () => new Response('private provider diagnostics', { status: 401 }) }), error => error.code === 'PROVIDER_REJECTED' && !error.message.includes(privateToken) && !error.message.includes('diagnostics'));
  await assert.rejects(sendTelegramNotification({ token: privateToken, chatId, message: 'Safe message', fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) }), error => error.code === 'INVALID_RESPONSE');
});

test('Telegram CLI reports the exact isolated blocker when bindings are unavailable', async () => {
  let output = '';
  let errors = '';
  const code = await runTelegramNotificationCli({ env: {}, argv: [], fetchImpl: async () => { throw new Error('must not fetch'); }, stdout: { write: value => { output += value; } }, stderr: { write: value => { errors += value; } } });
  assert.equal(code, 2);
  assert.match(output, /BLOCKED — REQUIRED_SECRET_NOT_CONFIGURED/);
  assert.match(output, /TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/);
  assert.equal(errors, '');
});
