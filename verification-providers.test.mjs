import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  AgentMailOtpVerificationProvider,
  AppsScriptOtpVerificationProvider,
  BrevoOtpVerificationProvider,
  BridgeOtpVerificationProvider,
  createConfiguredVerificationProviders,
  DeadSimpleEmailOtpVerificationProvider,
  HankoOtpVerificationProvider,
  MailjetOtpVerificationProvider,
  MailerSendOtpVerificationProvider,
  OfficialWhatsAppVerificationProvider,
  OryOtpVerificationProvider,
  ResendOtpVerificationProvider,
  TelegramLinkVerificationProvider
} from './auth-native/verification/providers.mjs';
import { VERIFICATION_FAILURE_CLASS } from './auth-native/verification/provider-contract.mjs';
import { __verificationProvidersTest } from './auth-native/verification/providers.mjs';
const { otpEmailBody } = __verificationProvidersTest;

const json = (body, status = 200) => Response.json(body, { status });
const KEY = `provider-key-${'k'.repeat(32)}`;

test('six OTP slots implement the shared contract and fail closed when not securely configured', async () => {
  const providers = createConfiguredVerificationProviders({});
  assert.deepEqual(providers.map(row => row.id), ['otp-a', 'otp-b', 'otp-c', 'otp-d', 'otp-e', 'otp-f', 'otp-g', 'otp-h', 'otp-i', 'otp-j', 'otp-k', 'otp-l', 'otp-m', 'whatsapp', 'telegram']);
  for (const provider of providers) {
    assert.equal((await provider.checkAvailability()).available, false);
    assert.equal((await provider.getRemainingQuota()).remaining, 0);
    assert.equal((await provider.getProviderStatus()).configured, false);
    await assert.rejects(
      () => provider.sendVerification({}),
      error => error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD
    );
  }
});

test('OTP bridge uses bounded HTTPS server calls for health, exact quota, and delivery', async () => {
  const calls = [];
  const provider = new BridgeOtpVerificationProvider({
    id: 'otp-a',
    origin: 'https://otp-bridge.example',
    apiKey: KEY,
    declaredDailyQuota: 250,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/health')) return json({ ok: true, ready: true });
      if (String(url).endsWith('/quota')) return json({ remaining: 88, limit: 100, resetAt: 1_900_000_000_000 });
      return json({ accepted: true, messageRef: 'message-reference-1234567890' });
    }
  });
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  assert.deepEqual(await provider.getRemainingQuota(), { remaining: 88, limit: 100, resetAt: 1_900_000_000_000, source: 'provider-api' });
  assert.deepEqual(await provider.sendVerification({
    attemptId: 'attempt-12345678901234567890',
    destination: 'student@example.com',
    code: '123456',
    purpose: 'account-backup',
    expiresAt: 1_800_000_300_000
  }), { accepted: true });
  const send = calls.find(call => call.url.endsWith('/send'));
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true);
  assert.equal(send.init.headers['X-Verification-Key'], KEY);
  const body = JSON.parse(send.init.body);
  assert.equal(body.code, '123456');
  assert.equal(body.destination, 'student@example.com');
});

test('OTP bridge classifies user, hard, and temporary provider failures for safe retry decisions', async () => {
  for (const row of [
    { status: 400, expected: VERIFICATION_FAILURE_CLASS.USER },
    { status: 401, expected: VERIFICATION_FAILURE_CLASS.HARD },
    { status: 503, expected: VERIFICATION_FAILURE_CLASS.TEMPORARY }
  ]) {
    const provider = new BridgeOtpVerificationProvider({
      id: 'otp-a', origin: 'https://otp-bridge.example', apiKey: KEY, declaredDailyQuota: 10,
      fetchImpl: async () => json({ error: { code: `REMOTE_MUST_NOT_LEAK_${KEY}` } }, row.status)
    });
    await assert.rejects(
      () => provider.sendVerification({ destination: 'student@example.com', code: '123456' }),
      error => error?.failureClass === row.expected && error?.code === `PROVIDER_HTTP_${row.status}`
    );
  }
});

test('WhatsApp adapter calls only the official Graph API with an approved template and locally verified code', async () => {
  const calls = [];
  const provider = new OfficialWhatsAppVerificationProvider({
    graphVersion: 'v99.0',
    phoneNumberId: '123456789012345',
    accessToken: `meta-token-${'m'.repeat(40)}`,
    templateName: 'admission_hub_verification',
    templateLanguage: 'bn_BD',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return init.method === 'GET'
        ? json({ id: '123456789012345' })
        : json({ messages: [{ id: 'wamid-message-reference-1234567890' }] });
    }
  });
  assert.equal((await provider.checkAvailability()).available, true);
  await provider.sendVerification({ destination: '+8801700000000', code: '654321' });
  const send = calls.find(call => call.init.method === 'POST');
  assert.match(send.url, /^https:\/\/graph\.facebook\.com\/v99\.0\/123456789012345\/messages$/);
  assert.match(send.init.headers.Authorization, /^Bearer /);
  const body = JSON.parse(send.init.body);
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.type, 'template');
  assert.equal(body.template.name, 'admission_hub_verification');
  assert.equal(body.template.components[0].parameters[0].text, '654321');
  assert.equal(provider.verificationMode, 'local-code');
});

test('Telegram adapter creates a one-time bot link and sends a protected OTP only after START', async () => {
  let getMeCalls = 0;
  let telegramMessage = null;
  const provider = new TelegramLinkVerificationProvider({
    botUsername: 'AdmissionHubVerifyBot',
    botToken: `123456:${'t'.repeat(35)}`,
    webhookSecret: `webhook-${'w'.repeat(32)}`,
    webhookUrl: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init = {}) => {
      getMeCalls += 1;
      assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/);
      if (String(url).endsWith('/getWebhookInfo')) {
        return json({ ok: true, result: { url: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook', allowed_updates: ['message'] } });
      }
      if (String(url).endsWith('/sendMessage')) {
        telegramMessage = JSON.parse(init.body);
        return json({ ok: true, result: { message_id: 77 } });
      }
      return json({ ok: true, result: { id: 123456, is_bot: true, username: 'AdmissionHubVerifyBot' } });
    }
  });
  assert.equal((await provider.checkAvailability()).available, true);
  const linkToken = 'A'.repeat(43);
  const sent = await provider.sendVerification({ linkToken });
  assert.equal(sent.accepted, true);
  const link = new URL(sent.interaction.url);
  assert.equal(link.origin, 'https://t.me');
  assert.equal(link.searchParams.get('start'), linkToken);
  assert.equal(getMeCalls, 2);
  assert.equal(provider.verificationMode, 'local-code');
  assert.deepEqual(await provider.sendTelegramCode({ chatId: '123456789', code: '654321', expiresInSeconds: 300 }), { accepted: true });
  assert.equal(getMeCalls, 3);
  assert.equal(telegramMessage.chat_id, '123456789');
  assert.equal(telegramMessage.protect_content, true);
  assert.equal(telegramMessage.disable_web_page_preview, true);
  assert.match(telegramMessage.text, /AdmissionSky Verification/);
  assert.match(telegramMessage.text, /654321/);
  assert.match(telegramMessage.text, /5 মিনিট/);
  assert.doesNotMatch(telegramMessage.text, /API key|secret|Gmail password/i);
  await assert.rejects(() => provider.verifyCode({ code: '654321' }), error => error?.code === 'LOCAL_VERIFICATION_ONLY');
});

test('Telegram canary derives a separate webhook secret, validates the token identity, and configures only an empty webhook slot', async () => {
  const webhookUrl = 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook';
  const rootSecret = `root-auth-secret-${'r'.repeat(40)}`;
  let activeWebhook = '';
  let activationSecret = '';
  const calls = [];
  const provider = new TelegramLinkVerificationProvider({
    botToken: `654321:${'z'.repeat(35)}`,
    webhookSecretSource: rootSecret,
    webhookUrl,
    declaredDailyQuota: 172800,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      calls.push({ target, method: init.method || 'GET' });
      if (target.endsWith('/getMe')) return json({ ok: true, result: { id: 654321, is_bot: true, username: 'AdmissionHubCanaryBot' } });
      if (target.endsWith('/getWebhookInfo')) return json({ ok: true, result: { url: activeWebhook, allowed_updates: activeWebhook ? ['message'] : [] } });
      if (target.endsWith('/setWebhook')) {
        const body = JSON.parse(init.body);
        assert.equal(body.url, webhookUrl);
        assert.deepEqual(body.allowed_updates, ['message']);
        assert.equal(body.drop_pending_updates, false);
        assert.match(body.secret_token, /^[A-Za-z0-9_-]{20,256}$/);
        assert.notEqual(body.secret_token, rootSecret);
        activationSecret = body.secret_token;
        activeWebhook = body.url;
        return json({ ok: true, result: true });
      }
      if (target === webhookUrl) {
        assert.equal(init.headers['X-Telegram-Bot-Api-Secret-Token'], activationSecret);
        return json({ ok: true });
      }
      throw new Error('unexpected request');
    }
  });
  const activated = await provider.configureWebhook();
  assert.deepEqual(activated, {
    ready: true,
    identityReady: true,
    webhookReady: true,
    endpointAccepted: true,
    webhookChanged: true
  });
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  const sent = await provider.sendVerification({ linkToken: 'D'.repeat(43) });
  assert.equal(new URL(sent.interaction.url).hostname, 't.me');
  assert.equal(calls.some(call => call.target.includes(rootSecret)), false);
});

test('Telegram canary refuses to overwrite another webhook integration', async () => {
  let mutationCalls = 0;
  const provider = new TelegramLinkVerificationProvider({
    botToken: `777777:${'q'.repeat(35)}`,
    webhookSecret: `safe-webhook-${'s'.repeat(32)}`,
    webhookUrl: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    declaredDailyQuota: 10,
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/getMe')) return json({ ok: true, result: { id: 777777, is_bot: true, username: 'AdmissionHubConflictBot' } });
      if (String(url).endsWith('/getWebhookInfo')) return json({ ok: true, result: { url: 'https://another.example/webhook' } });
      if (init.method === 'POST') mutationCalls += 1;
      return json({ ok: true, result: true });
    }
  });
  await assert.rejects(() => provider.configureWebhook(), error => error?.code === 'WEBHOOK_CONFLICT');
  assert.equal(mutationCalls, 0);
});

test('Telegram Auth reuses the existing server-only bot binding without copying or exposing its value', async () => {
  const providers = createConfiguredVerificationProviders({
    TG_BOT_TOKEN: `888888:${'v'.repeat(35)}`,
    AUTH_HMAC_SECRET: `auth-root-${'a'.repeat(48)}`,
    TELEGRAM_AUTH_WEBHOOK_URL: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    TELEGRAM_AUTH_DAILY_QUOTA: '172800'
  }, { fetchImpl: async () => json({ ok: false }, 503) });
  const telegram = providers.find(provider => provider.id === 'telegram');
  assert.equal((await telegram.getProviderStatus()).configured, true);
  assert.equal((await telegram.getRemainingQuota()).source, 'internal-safety-cap');
  assert.equal('TG_BOT_TOKEN' in telegram, false);
});

test('Brevo OTP provider sends through the Brevo API and derives quota from account credits', async () => {
  const calls = [];
  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a',
    apiKey: KEY,
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 300,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/v3/senders')) return json({ senders: [{ id: 1, name: 'Admission hub', email: 'sender@example.com', active: true }] });
      if (String(url).endsWith('/v3/account')) return json({ plan: [{ type: 'free', credits: 299, creditsType: 'sendLimit' }] });
      return json({ messageId: '<202609171120.63980787322@smtp-relay.mailin.fr>' }, 201);
    }
  });

  assert.equal((await provider.checkAvailability()).available, true);
  const rename = calls.find(call => /\/v3\/senders\/1$/.test(call.url));
  assert.ok(rename, 'expected the drifted sender name to be corrected on the probe');
  assert.equal(rename.init.method, 'PUT');
  assert.equal(JSON.parse(rename.init.body).name, 'AdmissionSky');
  const quota = await provider.getRemainingQuota();
  assert.equal(quota.remaining, 299);
  assert.equal(quota.limit, 300);
  assert.equal(quota.source, 'brevo-account-credits');
  assert.ok(quota.resetAt > Date.now());

  await provider.sendVerification({ destination: 'user@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
  const send = calls.find(call => call.url.endsWith('/v3/smtp/email'));
  const body = JSON.parse(send.init.body);
  assert.equal(send.init.headers['api-key'], KEY);
  assert.equal(body.sender.email, 'sender@example.com');
  assert.deepEqual(body.to, [{ email: 'user@example.com' }]);
  assert.match(body.textContent, /123456/);
  assert.match(body.htmlContent, /123456/);
  assert.match(body.subject, /AdmissionSky, আপনার যাচাইকরণ কোড/);
  assert.match(body.htmlContent, /AdmissionSky/);
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true);
});

test('Brevo OTP provider leaves an already-correct sender name untouched', async () => {
  const calls = [];
  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a',
    apiKey: KEY,
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 300,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ senders: [{ id: 1, name: 'AdmissionSky', email: 'sender@example.com', active: true }] });
    }
  });

  assert.equal((await provider.checkAvailability()).available, true);
  assert.equal(calls.some(call => call.init.method === 'PUT'), false);
});

test('every email provider brands the sender name and the body without an env override', async () => {
  // With no *_FROM_NAME binding the providers must fall back to the brand rather
  // than a vendor name, so a missing or drifted secret cannot leak "Admission hub"
  // or a provider default into a login email.
  const cases = [
    {
      name: 'brevo',
      build: fetchImpl => new BrevoOtpVerificationProvider({ id: 'otp-a', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 300, fetchImpl }),
      ready: () => json({ senders: [{ id: 1, name: 'AdmissionSky', email: 'sender@example.com', active: true }] }),
      sendUrl: '/v3/smtp/email',
      nameOf: body => body.sender.name
    },
    {
      name: 'resend',
      build: fetchImpl => new ResendOtpVerificationProvider({ id: 'otp-d', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 100, fetchImpl }),
      ready: () => json({ data: [{ name: 'example.com', status: 'verified', capabilities: { sending: 'enabled' } }] }),
      sendUrl: '/emails',
      nameOf: body => body.from.replace(/\s*<.*$/, '')
    },
    {
      name: 'mailersend',
      build: fetchImpl => new MailerSendOtpVerificationProvider({ id: 'otp-f', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 100, fetchImpl }),
      ready: () => json({ data: [{ name: 'example.com', is_verified: true, domain_settings: { send_paused: false } }] }),
      sendUrl: '/v1/email',
      nameOf: body => body.from.name
    },
    {
      name: 'mailjet',
      build: fetchImpl => new MailjetOtpVerificationProvider({ id: 'otp-c', apiKey: KEY, secretKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 200, fetchImpl }),
      ready: () => json({ Data: [{ Email: 'sender@example.com', Status: 'Active' }] }),
      sendUrl: '/v3.1/send',
      nameOf: body => body.Messages[0].From.Name
    }
  ];

  for (const testCase of cases) {
    const calls = [];
    const provider = testCase.build(async (url, init) => {
      calls.push({ url: String(url), init });
      if (init && init.method === 'POST' && String(url).includes(testCase.sendUrl)) {
        return json({ messageId: 'ref-1', id: 'ref-1', Messages: [{ To: [{ MessageUUID: 'ref-1' }] }] }, 201);
      }
      return testCase.ready();
    });

    await provider.checkAvailability();
    await provider.sendVerification({ destination: 'user@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
    const send = calls.find(call => call.url.includes(testCase.sendUrl));
    const body = JSON.parse(send.init.body);
    assert.equal(testCase.nameOf(body), 'AdmissionSky', `${testCase.name}: sender name must be the brand`);
    const subject = body.subject || body.Messages[0].Subject;
    assert.match(subject, /AdmissionSky, আপনার যাচাইকরণ কোড/, `${testCase.name}: subject must carry the brand`);
  }
});

test('Backup OTP email carries the AdmissionSky brand, one big code box, and dark-mode styles', () => {
  const { text, html } = otpEmailBody('123456', 10, 'মাহমুদ রাসেল');

  assert.equal(html.includes('<script'), false);
  assert.match(html, /color-scheme" content="light dark"/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /AdmissionSky/);
  assert.equal(html.includes('Admission Hub'), false);
  assert.match(html, /Your Admission Companion/);
  assert.match(html, /AdmissionSky অ্যাকাউন্ট যাচাই করতে/);
  assert.match(html, /প্রিয় মাহমুদ রাসেল,/);
  assert.match(html, /10 মিনিট/);
  assert.match(html, /AdmissionSky-এর কেউ কখনও আপনার কোড চাইবে না।/);
  assert.match(text, /AdmissionSky Team/);
  assert.match(text, /মাহমুদ রাসেল/);
  assert.match(text, /123456/);

  // The owner asked for the onboarding brand mark in the header. The old
  // "Admission Hub" banner asset must stay out, and inline SVG stays out because
  // Gmail and Outlook strip it, so the mark ships as a hosted PNG.
  assert.match(html, /icons\/email-mark\.png/);
  assert.equal(/email-logo\.png/.test(html), false);
  assert.equal(/data:image\/svg\+xml;base64,/.test(html), false);

  // Design contract, checked against markup only so the style block cannot
  // satisfy an assertion that the inline layout should.
  const markup = html.replace(/<style>[\s\S]*?<\/style>/, '');
  assert.match(markup, /Admission<span style="color:#2F6BFF;">Sky<\/span>/);
  assert.equal(/border[^;"]*(dashed|dotted)/.test(html), false);
  assert.match(markup, /'SF Mono','Roboto Mono'/);
  assert.match(markup, /font-size:48px/);
  assert.match(markup, /letter-spacing:10px/);
  assert.match(markup, /class="ah-otp-box"/);
  assert.match(markup, /'Hind Siliguri','Noto Sans Bengali','Nirmala UI',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif/);
  // Bengali clusters collide under tightened tracking, so the heading keeps the default.
  assert.equal(/ah-heading[^>]*letter-spacing/.test(markup), false);
  assert.equal(/#fff2d9|#e4a620|#856221/i.test(html), false);
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), false);
  assert.equal(/❓|🔒|✅|⚠/.test(html), false);

  // Nothing may outline the message: no shadow on the card.
  assert.equal(/box-shadow:\s*(?!none)/.test(markup), false);

  // Exactly one container opts into max-width, and it requests the responsive
  // pair rather than a fixed pixel width.
  assert.deepEqual(markup.match(/max-width:\d+px/g), ['max-width:560px']);
  const cardTag = (markup.match(/<table[^>]*class="ah-card"[^>]*>/) || [''])[0];
  assert.match(cardTag, /width="100%"/);
  assert.match(cardTag, /max-width:560px/);
  assert.equal(/(?<!max-)\bwidth:\d+px/.test(cardTag), false);
  assert.equal(/\bwidth="\d+"/.test(cardTag), false);
  assert.match(html, /\.ah-shell \{ width: 100% !important; \}/);
  assert.match(html, /\.ah-card \{ width: 100% !important; max-width: 560px !important; margin: 0 auto !important; \}/);

  // Dark mode must move body, shell, and card to one surface, otherwise the card
  // floats as a box against the client's own dark chrome. The code box gets its
  // own darker tint so it still reads as a box.
  const dark = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(dark, /\.ah-body \{ background-color: #1f1f1f !important; \}/);
  assert.match(dark, /\.ah-shell \{ background-color: #1f1f1f !important; \}/);
  assert.match(dark, /\.ah-card \{ background-color: #1f1f1f !important;/);
  assert.match(dark, /\.ah-otp-box \{ background-color: #14342a !important; border-color: #1f5c45 !important; \}/);

  // Only these set a background in the markup: the card surfaces and the code box.
  const bgColors = [...new Set(markup.match(/background-color:#[0-9a-f]{6}/gi) || [])].sort();
  assert.deepEqual(bgColors, ['background-color:#f2fbf7', 'background-color:#ffffff']);

  const layoutTables = markup.match(/<table/g) || [];
  const presentational = markup.match(/<table role="presentation"/g) || [];
  assert.equal(layoutTables.length, presentational.length);
});

test('Backup OTP email escapes a hostile recipient name and falls back when absent', () => {
  const hostile = otpEmailBody('123456', 10, '<img src=x onerror=alert(1)>');
  assert.equal(hostile.html.includes('<img src=x'), false);
  assert.match(hostile.html, /&lt;img src=x/);
  assert.match(hostile.text, /প্রিয় <img src=x onerror=alert\(1\)>,/);

  const anonymous = otpEmailBody('123456', 10, '');
  assert.match(anonymous.html, /প্রিয় ব্যবহারকারী,/);
  assert.equal(anonymous.html.includes('প্রিয় ,'), false);
});

test('Brevo OTP provider fails closed when unconfigured and refuses a non-email destination', async () => {
  const unconfigured = new BrevoOtpVerificationProvider({ id: 'otp-a', declaredDailyQuota: 300 });
  assert.equal(unconfigured.configured, false);
  assert.equal((await unconfigured.checkAvailability()).code, 'NOT_CONFIGURED');
  assert.equal((await unconfigured.getRemainingQuota()).remaining, 0);
  await assert.rejects(() => unconfigured.sendVerification({ destination: 'user@example.com', code: '123456' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD);

  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 300,
    fetchImpl: async () => json({ messageId: 'x' }, 201)
  });
  await assert.rejects(() => provider.sendVerification({ destination: '+8801700000000', code: '123456' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.USER);
  await assert.rejects(() => provider.sendVerification({ destination: 'user@example.com', code: '12345' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.USER);
});

test('Brevo reports a sender that is not active instead of claiming readiness', async () => {
  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 300,
    fetchImpl: async () => json({ senders: [{ email: 'sender@example.com', active: false }] })
  });
  const availability = await provider.checkAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.code, 'SENDER_NOT_VERIFIED');
});

test('Apps Script OTP provider signs its calls and follows the Apps Script redirect', async () => {
  const calls = [];
  const secret = 'shared-secret-' + 's'.repeat(32);
  const provider = new AppsScriptOtpVerificationProvider({
    id: 'otp-b',
    webAppUrl: 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    sharedSecret: secret,
    declaredDailyQuota: 100,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      const action = init.method === 'POST' ? JSON.parse(init.body).action : new URL(String(url)).searchParams.get('action');
      if (action === 'health') return json({ ok: true, ready: true });
      if (action === 'quota') return json({ ok: true, limit: 100, remaining: 97, resetAt: 1_900_000_000_000 });
      return json({ ok: true, accepted: true, messageRef: 'gmail-message-ref-1234567890' });
    }
  });

  assert.equal(provider.configured, true);
  assert.equal((await provider.checkAvailability()).code, 'READY');
  assert.equal((await provider.getRemainingQuota()).source, 'apps-script-mail-quota');

  await provider.sendVerification({ destination: 'user@example.com', code: '654321' });
  const send = calls.find(call => call.init.method === 'POST');
  const posted = JSON.parse(send.init.body);
  assert.equal(posted.action, 'send');
  assert.equal(posted.destination, 'user@example.com');
  assert.equal(posted.code, '654321');
  const expected = createHmac('sha256', secret)
    .update(['send', posted.timestamp, posted.nonce, posted.destination, posted.code].join('\n'))
    .digest('base64url');
  assert.equal(posted.signature, expected);
  assert.equal(calls.every(call => call.init.redirect === 'follow'), true);
});

test('Apps Script OTP provider rejects non-Google web app URLs and weak secrets', () => {
  const base = { id: 'otp-b', declaredDailyQuota: 100 };
  for (const webAppUrl of [
    'https://evil.example/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    'https://script.google.com/macros/s/short/exec',
    'http://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec?x=1'
  ]) {
    assert.equal(new AppsScriptOtpVerificationProvider({ ...base, webAppUrl, sharedSecret: 's'.repeat(40) }).configured, false, webAppUrl);
  }
  const validUrl = 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec';
  assert.equal(new AppsScriptOtpVerificationProvider({ ...base, webAppUrl: validUrl, sharedSecret: 'short' }).configured, false);
});

test('Mailjet OTP provider verifies an active single sender without requiring a custom domain', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes('/v3/REST/sender')) {
      return json({ Data: [{ Email: 'sender@example.com', Status: 'active' }] });
    }
    if (String(url).includes('/v3/REST/metasender')) return json({ Data: [] });
    return json({ Messages: [{ To: [{ MessageUUID: 'mailjet-message-ref' }] }] });
  };
  const provider = new MailjetOtpVerificationProvider({
    apiKey: KEY,
    secretKey: KEY,
    apiBase: 'https://api.mailjet.com',
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 200,
    fetchImpl
  });

  assert.equal(provider.configured, true);
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  // Basic auth must keep its base64 padding or Mailjet rejects the request outright.
  const expected = `Basic ${Buffer.from(`${KEY}:${KEY}`, 'utf8').toString('base64')}`;
  assert.equal(calls[0].init.headers.Authorization, expected);
  assert.equal(calls[0].url, 'https://api.mailjet.com/v3/REST/sender?SenderEmail=sender%40example.com');

  const sent = await provider.sendVerification({ destination: 'learner@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
  assert.deepEqual(sent, { accepted: true });
  const sendCall = calls.find(call => call.url.includes('/v3.1/send'));
  const body = JSON.parse(sendCall.init.body);
  assert.equal(sendCall.url, 'https://api.mailjet.com/v3.1/send');
  assert.equal(body.Messages[0].From.Email, 'sender@example.com');
  assert.equal(body.Messages[0].To[0].Email, 'learner@example.com');
  assert.match(body.Messages[0].TextPart, /123456/);
  assert.match(body.Messages[0].HTMLPart, /123456/);

  const quota = await provider.getRemainingQuota();
  assert.equal(quota.limit, 200);
  assert.equal(quota.remaining, 200);
  assert.equal(quota.source, 'mailjet-declared-daily-quota');
});

test('Mailjet OTP provider accepts a sender that only the subaccount metasender endpoint lists', async () => {
  // A sender living in a subaccount never appears in /sender; reading only that
  // endpoint would report a working address as unverified and drop the slot.
  const provider = new MailjetOtpVerificationProvider({
    apiKey: KEY,
    secretKey: KEY,
    apiBase: 'https://api.mailjet.com',
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 200,
    fetchImpl: async url => (String(url).includes('/v3/REST/sender')
      ? json({ Data: [] })
      : json({ Data: [{ Email: 'sender@example.com', IsEnabled: true }] }))
  });
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
});

test('Mailjet OTP provider reports an unconfirmed sender instead of claiming readiness', async () => {
  const provider = new MailjetOtpVerificationProvider({
    apiKey: KEY,
    secretKey: KEY,
    apiBase: 'https://api.mailjet.com',
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 200,
    fetchImpl: async () => json({ Data: [{ Email: 'sender@example.com', Status: 'pending' }] })
  });
  assert.deepEqual(await provider.checkAvailability(), { available: false, code: 'SENDER_NOT_VERIFIED' });
});

test('Mailjet OTP provider treats a failing probe as an outage rather than an unverified sender', async () => {
  const provider = new MailjetOtpVerificationProvider({
    apiKey: KEY,
    secretKey: KEY,
    apiBase: 'https://api.mailjet.com',
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 200,
    fetchImpl: async () => new Response('nope', { status: 500 })
  });
  await assert.rejects(provider.checkAvailability());
});

test('Mailjet OTP provider fails closed on an unapproved API region and when unconfigured', async () => {
  const base = { apiKey: KEY, secretKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 200, fetchImpl: async () => json({}) };
  assert.equal(new MailjetOtpVerificationProvider({ ...base, apiBase: 'https://api.mailjet.com' }).configured, true);
  assert.equal(new MailjetOtpVerificationProvider({ ...base, apiBase: 'https://api.us.mailjet.com' }).configured, true);
  assert.equal(new MailjetOtpVerificationProvider({ ...base, apiBase: 'https://attacker.example' }).configured, false);
  assert.equal(new MailjetOtpVerificationProvider({ ...base, apiBase: '' }).configured, false);

  const bare = new MailjetOtpVerificationProvider({});
  assert.equal(bare.configured, false);
  assert.deepEqual(await bare.checkAvailability(), { available: false, code: 'NOT_CONFIGURED' });
  await assert.rejects(bare.sendVerification({ destination: 'learner@example.com', code: '123456' }), error => error.code === 'NOT_CONFIGURED');
});

test('Mailjet OTP provider refuses a non-email destination or a malformed code', async () => {
  const provider = new MailjetOtpVerificationProvider({ apiKey: KEY, secretKey: KEY, apiBase: 'https://api.mailjet.com', fromAddress: 'sender@example.com', declaredDailyQuota: 200, fetchImpl: async () => json({}) });
  await assert.rejects(provider.sendVerification({ destination: 'not-an-email', code: '123456' }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.USER);
  await assert.rejects(provider.sendVerification({ destination: 'learner@example.com', code: '12345' }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.USER);
});

test('Mailjet OTP provider rejects a delivery response without a message reference', async () => {
  const provider = new MailjetOtpVerificationProvider({
    apiKey: KEY,
    secretKey: KEY,
    apiBase: 'https://api.mailjet.com',
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 200,
    fetchImpl: async () => json({ Messages: [{ To: [{}] }] })
  });
  await assert.rejects(
    provider.sendVerification({ destination: 'learner@example.com', code: '123456' }),
    error => error.code === 'INVALID_PROVIDER_RESPONSE' && error.failureClass === VERIFICATION_FAILURE_CLASS.HARD
  );
});

test('OTP slots prefer Brevo and Apps Script and fall back to bridge bindings', async () => {
  const scriptsUrl = 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec';
  const preferred = createConfiguredVerificationProviders({
    BREVO_API_KEY: KEY,
    BREVO_FROM_ADDRESS: 'sender@example.com',
    OTP_A_DAILY_QUOTA: '300',
    OTP_B_PROVIDER_APPS_SCRIPT_URL: scriptsUrl,
    OTP_B_PROVIDER_SHARED_SECRET: 'shared-secret-' + 's'.repeat(32),
    OTP_B_DAILY_QUOTA: '100'
  });
  assert.equal(preferred[0] instanceof BrevoOtpVerificationProvider, true);
  assert.equal(preferred[0].id, 'otp-a');
  assert.equal(preferred[1] instanceof AppsScriptOtpVerificationProvider, true);
  assert.equal(preferred[1].id, 'otp-b');

  const withMailjet = createConfiguredVerificationProviders({
    MAILJET_API_KEY: KEY,
    MAILJET_SECRET_KEY: KEY,
    MAILJET_API_BASE: 'https://api.mailjet.com',
    MAILJET_FROM_ADDRESS: 'sender@example.com',
    OTP_C_DAILY_QUOTA: '200'
  });
  assert.equal(withMailjet[2] instanceof MailjetOtpVerificationProvider, true);
  assert.equal(withMailjet[2].id, 'otp-c');
  assert.equal(withMailjet[2].configured, true);
  // A half-bound slot must fall back rather than send unauthenticated requests.
  const halfBound = createConfiguredVerificationProviders({ MAILJET_API_KEY: KEY, MAILJET_FROM_ADDRESS: 'sender@example.com', MAILJET_API_BASE: 'https://api.mailjet.com', OTP_C_DAILY_QUOTA: '200' });
  assert.equal(halfBound[2].constructor.name, 'BridgeOtpVerificationProvider');

  const bridged = createConfiguredVerificationProviders({
    OTP_A_PROVIDER_ORIGIN: 'https://otp-bridge.example',
    OTP_A_PROVIDER_KEY: KEY,
    OTP_A_DAILY_QUOTA: '200',
    OTP_B_PROVIDER_ORIGIN: 'https://otp-bridge-two.example',
    OTP_B_PROVIDER_KEY: KEY,
    OTP_B_DAILY_QUOTA: '200'
  });
  assert.equal(bridged[0].getProviderStatus ? true : false, true);
  assert.equal(bridged[0].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(bridged[1].constructor.name, 'BridgeOtpVerificationProvider');

  const empty = createConfiguredVerificationProviders({});
  assert.deepEqual(empty.map(row => row.id), ['otp-a', 'otp-b', 'otp-c', 'otp-d', 'otp-e', 'otp-f', 'otp-g', 'otp-h', 'otp-i', 'otp-j', 'otp-k', 'otp-l', 'otp-m', 'whatsapp', 'telegram']);
  for (const provider of empty) assert.equal((await provider.getProviderStatus()).configured, false);
});

test('Resend owns otp-d and is chosen only when its key and sender address are both present', async () => {
  const bound = createConfiguredVerificationProviders({
    RESEND_API_KEY: KEY,
    RESEND_FROM_ADDRESS: 'sender@admissionhub.dev',
    OTP_D_DAILY_QUOTA: '100'
  });
  assert.equal(bound[3] instanceof ResendOtpVerificationProvider, true);
  assert.equal(bound[3].id, 'otp-d');
  assert.equal(bound[3].configured, true);
  // The key alone must never reach the wire: Resend rejects sends without a sender.
  const halfBound = createConfiguredVerificationProviders({ RESEND_API_KEY: KEY, OTP_D_DAILY_QUOTA: '100' });
  assert.equal(halfBound[3].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(halfBound[3].configured, false);
});

test('AgentMail owns otp-e and sends from an inbox instead of a verified domain', async () => {
  const bound = createConfiguredVerificationProviders({
    AGENTMAIL_API_KEY: KEY,
    AGENTMAIL_INBOX_ID: 'admission-hub@agentmail.to',
    OTP_E_DAILY_QUOTA: '100'
  });
  assert.equal(bound[4] instanceof AgentMailOtpVerificationProvider, true);
  assert.equal(bound[4].id, 'otp-e');
  assert.equal(bound[4].configured, true);
  // No verified domain or from-address is involved: the sending inbox is the sender.
  const halfBound = createConfiguredVerificationProviders({ AGENTMAIL_API_KEY: KEY, OTP_E_DAILY_QUOTA: '100' });
  assert.equal(halfBound[4].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(halfBound[4].configured, false);
});

test('AgentMail syncs the inbox display name to the brand before reporting ready', async () => {
  const calls = [];
  const inbox = { inbox_id: 'admission-hub@agentmail.to', display_name: 'AgentMail' };
  const make = (getPayload, patchPayload) => new AgentMailOtpVerificationProvider({
    id: 'otp-e',
    apiKey: KEY,
    inboxId: 'admission-hub@agentmail.to',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
      return json(init.method === 'PATCH' ? patchPayload : getPayload);
    }
  });

  // A vendor default name is overwritten once, and only once: the PATCH carries the
  // brand and the probe still reports ready so the send is never blocked.
  const drifted = await make(inbox, { inbox_id: inbox.inbox_id, display_name: 'AdmissionSky' }).checkAvailability();
  assert.deepEqual(drifted, { available: true, code: 'READY' });
  const patch = calls.filter(call => call.method === 'PATCH');
  assert.equal(patch.length, 1);
  assert.equal(JSON.parse(patch[0].body).display_name, 'AdmissionSky');

  // An already-branded inbox costs no write at all.
  calls.length = 0;
  const settled = await make({ ...inbox, display_name: 'AdmissionSky' }, inbox).checkAvailability();
  assert.deepEqual(settled, { available: true, code: 'READY' });
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);

  // A refused write is reported but never turns a usable inbox into an outage.
  calls.length = 0;
  const refused = await make(inbox, { inbox_id: inbox.inbox_id, display_name: 'AgentMail' }).checkAvailability();
  assert.deepEqual(refused, { available: true, code: 'DISPLAY_NAME_UNSET' });
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
});

test('MailerSend owns otp-f and sends from a MailerSend-verified trial domain', async () => {
  const bound = createConfiguredVerificationProviders({
    MAILERSEND_API_KEY: KEY,
    MAILERSEND_FROM_ADDRESS: 'otp@test-p7kx4xw3rz7g9yjr.mlsender.net',
    OTP_F_DAILY_QUOTA: '100'
  });
  assert.equal(bound[5] instanceof MailerSendOtpVerificationProvider, true);
  assert.equal(bound[5].id, 'otp-f');
  assert.equal(bound[5].configured, true);
  // Without a from-address the slot falls back to the bridge rather than sending
  // from an unverified domain.
  const halfBound = createConfiguredVerificationProviders({ MAILERSEND_API_KEY: KEY, OTP_F_DAILY_QUOTA: '100' });
  assert.equal(halfBound[5].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(halfBound[5].configured, false);
});

test('MailerSend reports READY only when the trial domain is verified and not paused', async () => {
  const sender = 'otp@test-p7kx4xw3rz7g9yjr.mlsender.net';
  const make = payload => new MailerSendOtpVerificationProvider({
    id: 'otp-f',
    apiKey: KEY,
    fromAddress: sender,
    declaredDailyQuota: 100,
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });

  const verified = await make({ data: [{ name: sender.split('@').pop(), is_verified: true, domain_settings: { send_paused: false } }] }).checkAvailability();
  assert.deepEqual(verified, { available: true, code: 'READY' });

  const unverified = await make({ data: [{ name: sender.split('@').pop(), is_verified: false, domain_settings: { send_paused: false } }] }).checkAvailability();
  assert.deepEqual(unverified, { available: false, code: 'SENDER_NOT_VERIFIED' });

  const paused = await make({ data: [{ name: sender.split('@').pop(), is_verified: true, domain_settings: { send_paused: true } }] }).checkAvailability();
  assert.deepEqual(paused, { available: false, code: 'SENDER_NOT_VERIFIED' });
});

test('MailerSend accepts on a 202 with an empty body and rejects a malformed code', async () => {
  const calls = [];
  const provider = new MailerSendOtpVerificationProvider({
    id: 'otp-f',
    apiKey: KEY,
    fromAddress: 'otp@test-p7kx4xw3rz7g9yjr.mlsender.net',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }
  });
  const sent = await provider.sendVerification({ destination: 'student@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
  assert.deepEqual(sent, { accepted: true });
  assert.equal(calls[0].url, 'https://api.mailersend.com/v1/email');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from.email, 'otp@test-p7kx4xw3rz7g9yjr.mlsender.net');
  assert.deepEqual(body.to, [{ email: 'student@example.com' }]);

  await assert.rejects(
    () => provider.sendVerification({ destination: 'student@example.com', code: '12' }),
    error => error.code === 'INVALID_DESTINATION'
  );
});

test('Dead Simple Email owns otp-g and sends from a provider-signed inbox', async () => {
  const bound = createConfiguredVerificationProviders({
    DEADSIMPLEEMAIL_API_KEY: KEY,
    DEADSIMPLEEMAIL_INBOX_ID: '15ba6686-acd5-46e5-9923-8556720fb0fb',
    OTP_G_DAILY_QUOTA: '150'
  });
  assert.equal(bound[6] instanceof DeadSimpleEmailOtpVerificationProvider, true);
  assert.equal(bound[6].id, 'otp-g');
  assert.equal(bound[6].configured, true);
  // No from-address is involved: the sending inbox is the sender, so a missing
  // inbox id falls back to the bridge rather than sending from nowhere.
  const halfBound = createConfiguredVerificationProviders({ DEADSIMPLEEMAIL_API_KEY: KEY, OTP_G_DAILY_QUOTA: '150' });
  assert.equal(halfBound[6].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(halfBound[6].configured, false);
});

test('Dead Simple Email syncs the inbox display name to the brand before reporting ready', async () => {
  const inboxId = '15ba6686-acd5-46e5-9923-8556720fb0fb';
  const make = (inbox, patchBody = { data: { inbox_id: inboxId, display_name: 'AdmissionSky', status: 'active' } }) => {
    const calls = [];
    const provider = new DeadSimpleEmailOtpVerificationProvider({
      id: 'otp-g',
      apiKey: KEY,
      inboxId,
      declaredDailyQuota: 150,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (init && init.method === 'PATCH') return new Response(JSON.stringify(patchBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify(inbox), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    });
    return { provider, calls };
  };

  // An empty display_name is Dead Simple's default; the probe must set the brand.
  const drifted = make({ data: { inbox_id: inboxId, display_name: '', status: 'active' } });
  assert.deepEqual(await drifted.provider.checkAvailability(), { available: true, code: 'READY' });
  const patch = drifted.calls.find(call => call.init.method === 'PATCH');
  assert.ok(patch, 'expected the empty display name to be corrected on the probe');
  assert.equal(JSON.parse(patch.init.body).display_name, 'AdmissionSky');

  // An already-correct name is left untouched.
  const settled = make({ data: { inbox_id: inboxId, display_name: 'AdmissionSky', status: 'active' } });
  assert.deepEqual(await settled.provider.checkAvailability(), { available: true, code: 'READY' });
  assert.equal(settled.calls.some(call => call.init.method === 'PATCH'), false);

  // A paused inbox is not available even though the name could be synced.
  const paused = make({ data: { inbox_id: inboxId, display_name: 'AdmissionSky', status: 'paused' } });
  assert.deepEqual(await paused.provider.checkAvailability(), { available: false, code: 'INBOX_NOT_AVAILABLE' });
});

test('Dead Simple Email sends to /messages and requires a message id back', async () => {
  const calls = [];
  const provider = new DeadSimpleEmailOtpVerificationProvider({
    id: 'otp-g',
    apiKey: KEY,
    inboxId: '15ba6686-acd5-46e5-9923-8556720fb0fb',
    declaredDailyQuota: 150,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { message_id: 'e094b083-ad0a-46b9-98a8-390f7e6c4a2f' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
  });
  const sent = await provider.sendVerification({ destination: 'student@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
  assert.deepEqual(sent, { accepted: true });
  assert.equal(calls[0].url, 'https://api.deadsimple.email/v1/inboxes/15ba6686-acd5-46e5-9923-8556720fb0fb/messages');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, 'student@example.com');
  assert.equal(typeof body.html_body, 'string');
  assert.equal(typeof body.text_body, 'string');

  const silent = new DeadSimpleEmailOtpVerificationProvider({
    id: 'otp-g',
    apiKey: KEY,
    inboxId: '15ba6686-acd5-46e5-9923-8556720fb0fb',
    declaredDailyQuota: 150,
    fetchImpl: async () => new Response(JSON.stringify({ data: {} }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  });
  await assert.rejects(
    () => silent.sendVerification({ destination: 'student@example.com', code: '123456', expiresAt: Date.now() + 300_000 }),
    error => error.code === 'INVALID_PROVIDER_RESPONSE'
  );

  await assert.rejects(
    () => provider.sendVerification({ destination: 'student@example.com', code: '12' }),
    error => error.code === 'INVALID_DESTINATION'
  );
});


test('otp-h Logto uses its public defaults only when the owner enabled the slot', async () => {
  const off = createConfiguredVerificationProviders({}).find(row => row.id === 'otp-h');
  assert.equal(off.configured, false);
  const disabled = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-h', enabled: false, dailyQuota: 1000 }] })
  }).find(row => row.id === 'otp-h');
  assert.equal(disabled.configured, false);
  const on = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-h', enabled: true, dailyQuota: 1000 }] })
  }).find(row => row.id === 'otp-h');
  assert.equal(on.configured, true);
  assert.equal(on.endpoint, 'https://dl635v.logto.app');
  assert.equal((await on.getRemainingQuota()).limit, 1000);
  const broken = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '{not json' }).find(row => row.id === 'otp-h');
  assert.equal(broken.configured, false);
});

test('wrangler.toml stays off the Logto vars that broke the 64-variable free ceiling', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  for (const name of ['LOGTO_ENDPOINT', 'LOGTO_APP_ID', 'LOGTO_REDIRECT_URI', 'OTP_H_DAILY_QUOTA']) {
    assert.equal(new RegExp(`^${name}\\s*=`, 'm').test(toml), false, name);
  }
});


test('otp-i Appwrite uses its public defaults only when the owner enabled the slot', async () => {
  const off = createConfiguredVerificationProviders({}).find(row => row.id === 'otp-i');
  assert.equal(off.configured, false);
  const disabled = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: false, dailyQuota: 300 }] })
  }).find(row => row.id === 'otp-i');
  assert.equal(disabled.configured, false);
  const on = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }).find(row => row.id === 'otp-i');
  assert.equal(on.configured, true);
  assert.equal(on.verificationMode, 'provider-evidence');
  assert.equal(on.endpoint, 'https://fra.cloud.appwrite.io/v1');
  assert.equal(on.projectId, '6ad1e9280025bf4464ee');
  assert.equal((await on.getRemainingQuota()).limit, 300);
  const broken = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '{not json' }).find(row => row.id === 'otp-i');
  assert.equal(broken.configured, false);
});

test('otp-i Appwrite sends through the Email OTP API and checks the code at Appwrite', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/account/tokens/email')) return json({ $id: 'tok', userId: 'user123', secret: '' }, 201);
    if (url.endsWith('/account/sessions/token')) {
      if (JSON.parse(init.body).secret === '123456') {
        return new Response(JSON.stringify({ $id: 'sess1', userId: 'user123' }), { status: 201, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a_session_6ad1e9280025bf4464ee=abc; Path=/' } });
      }
      return json({ message: 'Invalid token', code: 401, type: 'user_invalid_token' }, 401);
    }
    if (url.endsWith('/account/sessions/current')) return new Response(null, { status: 204 });
    return json({}, 404);
  };
  const provider = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }, { fetchImpl }).find(row => row.id === 'otp-i');
  const attemptId = 'a'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.equal(calls[0].url, 'https://fra.cloud.appwrite.io/v1/account/tokens/email');
  assert.equal(calls[0].headers['X-Appwrite-Project'], '6ad1e9280025bf4464ee');
  assert.equal(calls[0].headers['X-Appwrite-Key'], undefined);
  assert.deepEqual(calls[0].body, { userId: 'unique()', email: 'student@gmail.com', phrase: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '12345' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const discard = calls.find(row => row.url.endsWith('/account/sessions/current'));
  assert.equal(discard.method, 'DELETE');
  assert.match(discard.headers.Cookie, /a_session_6ad1e9280025bf4464ee=abc/);
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('otp-i Appwrite classifies provider failures', async () => {
  const make = status => createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }, { fetchImpl: async () => json({ code: status }, status) }).find(row => row.id === 'otp-i');
  const attemptId = 'b'.repeat(32);
  await assert.rejects(make(501).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(429).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(401).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
});

test('wrangler.toml stays off the Appwrite vars so the 64-variable ceiling holds', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  for (const name of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'OTP_I_DAILY_QUOTA']) {
    assert.equal(new RegExp(`^${name}\\s*=`, 'm').test(toml), false, name);
  }
  assert.match(toml, /"id":"otp-i","enabled":true/);
});


const JK_CONFIG = JSON.stringify({ enabled: true, providers: [{ id: 'otp-j', enabled: true, dailyQuota: 300 }, { id: 'otp-k', enabled: true, dailyQuota: 300 }] });
const ORY = 'https://ecstatic-torvalds-2tcj5aljui.projects.oryapis.com';
const HANKO = 'https://9b4c7063-c179-4586-8481-a415631a710a.hanko.io';
const ORY_FLOW = '11111111-2222-4333-8444-555555555555';

test('otp-j Ory and otp-k Hanko use their public defaults only when the owner enabled the slot', async () => {
  for (const id of ['otp-j', 'otp-k']) {
    assert.equal(createConfiguredVerificationProviders({}).find(row => row.id === id).configured, false, id);
    const disabled = createConfiguredVerificationProviders({
      VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id, enabled: false, dailyQuota: 300 }] })
    }).find(row => row.id === id);
    assert.equal(disabled.configured, false, id);
    const off = createConfiguredVerificationProviders({
      VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: false, providers: [{ id, enabled: true, dailyQuota: 300 }] })
    }).find(row => row.id === id);
    assert.equal(off.configured, false, id);
    assert.equal(createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '{not json' }).find(row => row.id === id).configured, false, id);
    const on = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }).find(row => row.id === id);
    assert.equal(on.configured, true, id);
    assert.equal(on.verificationMode, 'provider-evidence');
    assert.equal((await on.getRemainingQuota()).limit, 300);
    assert.equal((await on.checkAvailability()).available, true);
  }
  const providers = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG });
  assert.equal(providers.find(row => row.id === 'otp-j').endpoint, ORY);
  assert.equal(providers.find(row => row.id === 'otp-k').endpoint, HANKO);
  assert.equal(new OryOtpVerificationProvider({ endpoint: 'https://evil.example', declaredDailyQuota: 5 }).configured, false);
  assert.equal(new OryOtpVerificationProvider({ endpoint: `${ORY}/path`, declaredDailyQuota: 5 }).configured, false);
  assert.equal(new HankoOtpVerificationProvider({ endpoint: 'http://9b4c7063-c179-4586-8481-a415631a710a.hanko.io', declaredDailyQuota: 5 }).configured, false);
  assert.equal(new HankoOtpVerificationProvider({ endpoint: 'https://x.hanko.io.evil.example', declaredDailyQuota: 5 }).configured, false);
});

function oryFake({ accountExists = false, code = '123456' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, body });
    const path = url.slice(ORY.length);
    if (init.method === 'GET' && /^\/self-service\/(login|registration)\/api$/.test(path)) return json({ id: ORY_FLOW, type: 'api', ui: { nodes: [] } });
    if (path === `/self-service/login?flow=${ORY_FLOW}`) {
      if (!accountExists) return json({ id: ORY_FLOW, state: 'choose_method', ui: { messages: [{ id: 4000035, text: 'This account does not exist or has not setup sign in with code.' }] } }, 400);
      if (!body.code) return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 1010014 }] } }, 400);
      if (body.code === code) return json({ session_token: 'ory_st_secret', session: { active: true, identity: { traits: { email: body.identifier } } } });
      return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 4010008 }] } }, 400);
    }
    if (path === `/self-service/registration?flow=${ORY_FLOW}`) {
      if (!body.code) return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 1040005 }] } }, 400);
      if (body.code === code) return json({ session_token: 'ory_st_secret', identity: { traits: { email: body.traits.email } }, session: { active: true } });
      return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 4040003 }] } }, 400);
    }
    if (path === '/self-service/logout/api' && init.method === 'DELETE') return new Response(null, { status: 204 });
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

test('otp-j Ory sends a one-time code (registration for a new address) and checks it at Ory', async () => {
  const { calls, fetchImpl } = oryFake();
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-j');
  const attemptId = 'j'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.deepEqual(calls.map(row => `${row.method} ${row.url.slice(ORY.length)}`), [
    'GET /self-service/login/api', `POST /self-service/login?flow=${ORY_FLOW}`,
    'GET /self-service/registration/api', `POST /self-service/registration?flow=${ORY_FLOW}`
  ]);
  assert.deepEqual(calls[1].body, { method: 'code', identifier: 'student@gmail.com' });
  assert.deepEqual(calls[3].body, { method: 'code', traits: { email: 'student@gmail.com' } });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '12345' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const logout = calls.find(row => row.url.endsWith('/self-service/logout/api'));
  assert.equal(logout.method, 'DELETE');
  assert.deepEqual(logout.body, { session_token: 'ory_st_secret' });
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('otp-j Ory uses the login flow for a known address', async () => {
  const { calls, fetchImpl } = oryFake({ accountExists: true });
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-j');
  const attemptId = 'k'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'known@icloud.com', attemptId }), { accepted: true });
  assert.equal(calls.some(row => row.url.includes('/registration')), false);
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  assert.deepEqual(calls.find(row => row.body?.code === '123456').body, { method: 'code', code: '123456', identifier: 'known@icloud.com' });
});

test('otp-j Ory classifies provider failures', async () => {
  const make = (status, payload = {}) => createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async (url, init) => (init.method === 'GET' && status < 400 ? json({ id: ORY_FLOW }) : json(payload, status))
  }).find(row => row.id === 'otp-j');
  const attemptId = 'l'.repeat(32);
  for (const [status, failureClass] of [[404, VERIFICATION_FAILURE_CLASS.HARD], [401, VERIFICATION_FAILURE_CLASS.HARD], [429, VERIFICATION_FAILURE_CLASS.TEMPORARY], [503, VERIFICATION_FAILURE_CLASS.TEMPORARY]]) {
    await assert.rejects(make(status).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === failureClass, String(status));
  }
  // Code method switched off in the console: the login submit is refused without 4000035.
  const refused = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async (url, init) => (init.method === 'GET' ? json({ id: ORY_FLOW }) : json({ ui: { messages: [{ id: 4000001 }] } }, 400))
  }).find(row => row.id === 'otp-j');
  await assert.rejects(refused.sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.code === 'PROVIDER_REJECTED' && error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
  await assert.rejects(make(200).verifyCode({ attemptId: 'm'.repeat(32), evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

function hankoFake({ code = '123456', deletion = true } = {}) {
  const calls = [];
  let step = 0;
  const next = (name, actions, status = 200, extra = {}) => {
    step += 1;
    const csrf = `csrf-${step}`;
    const out = { name, status, csrf_token: csrf, payload: {}, actions: Object.fromEntries(actions.map(a => [a, { href: `/flow?action=${a}%40f${step}`, action: a }])), ...extra };
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json', ...(name === 'success' ? { 'X-Auth-Token': 'hanko.jwt.token' } : {}) } });
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    const path = url.slice(HANKO.length);
    calls.push({ path, body, auth: init.headers.Authorization || '' });
    const action = (path.match(/action=([a-z_]+)/) || [])[1] || '';
    if (path === '/registration' || path === '/login' || path === '/profile') return next('preflight', ['register_client_capabilities'], 200, { flow: path });
    if (action === 'register_client_capabilities') {
      if (calls.some(row => row.path === '/profile') && init.headers.Authorization) return next('profile_init', deletion ? ['account_delete', 'email_create'] : ['email_create']);
      return calls.some(row => row.path === '/login') ? next('login_init', ['continue_with_login_identifier']) : next('registration_init', ['register_login_identifier']);
    }
    if (action === 'register_login_identifier' || action === 'continue_with_login_identifier') return next('passcode_confirmation', ['back', 'resend_passcode', 'verify_passcode']);
    if (action === 'verify_passcode') {
      if (body.input_data.code !== code) return next('passcode_confirmation', ['back', 'resend_passcode', 'verify_passcode'], 400, { error: { code: 'form_data_invalid_error' } });
      return next('mfa_method_chooser', ['continue_to_otp_secret_creation', 'skip']);
    }
    if (action === 'skip') return next('success', []);
    if (action === 'account_delete') return next('account_deleted', []);
    if (path === '/logout') return new Response(null, { status: 204 });
    return json({ code: 404 }, 404);
  };
  return { calls, fetchImpl };
}

test('otp-k Hanko sends a passcode through the Flow API, checks it at Hanko and deletes the account', async () => {
  const { calls, fetchImpl } = hankoFake();
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-k');
  const attemptId = 'n'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.equal(calls[0].path, '/registration');
  assert.deepEqual(calls[1].body, { input_data: { webauthn_available: false }, csrf_token: 'csrf-1' });
  assert.deepEqual(calls[2].body, { input_data: { email: 'student@gmail.com' }, csrf_token: 'csrf-2' });
  assert.equal(calls.every(row => row.auth === ''), true);
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: 'abc' }), { verified: false });
  // A wrong code makes Hanko issue a fresh href + csrf; the next try must use them.
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const verifies = calls.filter(row => row.path.includes('action=verify_passcode'));
  assert.equal(verifies.length, 2);
  assert.equal(verifies[1].body.csrf_token, 'csrf-4');
  assert.match(verifies[1].path, /%40f4$/);
  const deleted = calls.find(row => row.path.includes('action=account_delete'));
  assert.equal(deleted.auth, 'Bearer hanko.jwt.token');
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
  // Deleted at Hanko, so the next send is a fresh registration again.
  calls.length = 0;
  await provider.sendVerification({ destination: 'student@gmail.com', attemptId: 'o'.repeat(32) });
  assert.equal(calls[0].path, '/registration');
});

test('otp-k Hanko falls back to the login flow when the account could not be deleted', async () => {
  const { calls, fetchImpl } = hankoFake({ deletion: false });
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-k');
  await provider.sendVerification({ destination: 'kept@icloud.com', attemptId: 'p'.repeat(32) });
  assert.deepEqual(await provider.verifyCode({ attemptId: 'p'.repeat(32), evidence: '123456' }), { verified: true });
  assert.ok(calls.some(row => row.path === '/logout' && row.auth === 'Bearer hanko.jwt.token'));
  calls.length = 0;
  await provider.sendVerification({ destination: 'kept@icloud.com', attemptId: 'q'.repeat(32) });
  assert.equal(calls[0].path, '/login');
});

test('otp-k Hanko classifies provider failures', async () => {
  const make = status => createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async () => json({ code: status }, status)
  }).find(row => row.id === 'otp-k');
  const attemptId = 'r'.repeat(32);
  await assert.rejects(make(404).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(429).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(500).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
  // Hanko hands back an absolute or protocol-relative href: refuse to follow it.
  const hostile = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async () => json({ name: 'preflight', csrf_token: 'c', actions: { register_client_capabilities: { href: '//evil.example/x' } } })
  }).find(row => row.id === 'otp-k');
  await assert.rejects(hostile.sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.code === 'INVALID_PROVIDER_RESPONSE');
  await assert.rejects(make(200).verifyCode({ attemptId: 's'.repeat(32), evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('wrangler.toml enables otp-j and otp-k at 38 without new vars, ahead of the last-resort pair', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  for (const name of ['ORY_ENDPOINT', 'ORY_PROJECT_URL', 'HANKO_ENDPOINT', 'HANKO_API_URL', 'OTP_J_DAILY_QUOTA', 'OTP_K_DAILY_QUOTA']) {
    assert.equal(new RegExp(`^${name}\\s*=`, 'm').test(toml), false, name);
  }
  assert.match(toml, /\{"id":"otp-j","enabled":true,"priority":38,"dailyQuota":300/);
  assert.match(toml, /\{"id":"otp-k","enabled":true,"priority":38,"dailyQuota":300/);
  const rows = JSON.parse(toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1]).providers;
  const order = rows.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(row => row.id);
  assert.deepEqual(order.slice(order.indexOf('otp-f')), ['otp-f', 'otp-i', 'otp-j', 'otp-k', 'otp-l', 'otp-m', 'otp-n', 'otp-o', 'otp-q', 'otp-r', 'otp-s', 'otp-t', 'otp-u', 'otp-v', 'otp-w', 'otp-x', 'otp-y', 'otp-z', 'otp-za', 'otp-g', 'otp-c', 'telegram']);
});
