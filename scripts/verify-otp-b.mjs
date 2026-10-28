#!/usr/bin/env node
// Live end-to-end check for the otp-b Apps Script (Gmail) mailer.
//
//   node scripts/verify-otp-b.mjs <exec-url> <shared-secret> [sendTo]
//
// Drives the REAL AppsScriptOtpVerificationProvider, the same class the Worker
// constructs, so a pass here means production behaves identically. Without
// sendTo it stays non-mutating (health + quota only).

import { AppsScriptOtpVerificationProvider } from '../auth-native/verification/providers.mjs';

const [execUrl, sharedSecret, sendTo] = process.argv.slice(2);
if (!execUrl || !sharedSecret) {
  console.error('usage: verify-otp-b.mjs <exec-url> <shared-secret> [sendTo]');
  process.exit(2);
}

const provider = new AppsScriptOtpVerificationProvider({
  id: 'otp-b',
  webAppUrl: execUrl,
  sharedSecret,
  declaredDailyQuota: Number(process.env.OTP_B_DAILY_QUOTA || 100)
});

console.log('webAppUrl accepted :', provider.webAppUrl || '(REJECTED, url failed validation)');
console.log('configured         :', provider.configured);
if (!provider.configured) process.exit(1);

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` , ${detail}` : ''}`);
};

const attempt = async (name, run) => {
  try {
    return await run();
  } catch (error) {
    record(name, false, `${error?.code || error?.name}: ${error?.message}`);
    return null;
  }
};

const availability = await attempt('checkAvailability (live GET health)',
  () => provider.checkAvailability());
if (availability) {
  record('checkAvailability (live GET health)', availability.available === true,
    `available=${availability.available} code=${availability.code}`);
}

const quota = await attempt('getRemainingQuota (live GET quota)',
  () => provider.getRemainingQuota());
if (quota) {
  record('getRemainingQuota (live GET quota)',
    quota.remaining > 0 && quota.resetAt > 0,
    `remaining=${quota.remaining} limit=${quota.limit} source=${quota.source}`);
}

if (sendTo) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const sent = await attempt('sendVerification (live POST send)',
    () => provider.sendVerification({ destination: sendTo, code, expiresAt: Date.now() + 5 * 60_000 }));
  if (sent) {
    record('sendVerification (live POST send)', sent.accepted === true, `accepted=${sent.accepted}`);
    console.log(`      mailed code ${code} to ${sendTo}`);
  }
}

const failed = results.filter(ok => !ok).length;
console.log('');
console.log(failed === 0 ? `ALL ${results.length} LIVE CHECKS PASSED` : `${failed} of ${results.length} LIVE CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
