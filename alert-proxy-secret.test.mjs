/* SEC-003 (2026-10-30 audit). The browser-error alert chain was dead because
 * nobody ever bound ALERT_PROXY_SECRET, and the deploy step that should have
 * reported it printed a warning and exited 0. These tests pin the properties
 * that fix depends on, so the "green run, dead channel" state cannot come back
 * unnoticed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subtle } from 'node:crypto';

import {
  SECRET_NAME, WORKER, PAGES_PROJECTS, INVALID_SIGNATURE, ALERT_PROBE_BODY,
  provisionAlertProxySecret, checkAlertProxyChain, alertSignature, main,
} from './scripts/bind-alert-proxy-secret.mjs';

const WORKFLOW = readFileSync(new URL('./.github/workflows/deploy-pages-worker.yml', import.meta.url), 'utf8');

/* A wrangler stand-in: records every call, reports the secret names we choose,
 * and can fail one command so the ordering guarantees can be tested. */
function fakeRun({ listed = [], failOn = '' } = {}) {
  const calls = [];
  const run = async ({ args, input = '' }) => {
    calls.push({ args, input });
    const line = args.join(' ');
    if (line.startsWith('secret list')) {
      return { code: 0, stdout: JSON.stringify(listed.map((name) => ({ name, type: 'secret_text' }))), stderr: '' };
    }
    if (failOn && line.includes(failOn)) return { code: 1, stdout: '', stderr: 'boom' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const puts = () => calls.filter((c) => !c.args.join(' ').startsWith('secret list'));
  return { run, calls, puts };
}

test('SEC-003-১: a missing secret is generated once and bound to every holder', async () => {
  const { run, puts } = fakeRun();
  const { mode, holders, secret } = await provisionAlertProxySecret({ env: {}, run });
  assert.equal(mode, 'generated');
  assert.match(secret, /^[0-9a-f]{64}$/, '32 random bytes as hex');
  assert.deepEqual(holders, ['pages:admissionhub', 'pages:admissionsky', 'worker:admission-gk']);
  assert.equal(puts().length, 3);
  for (const call of puts()) assert.equal(call.input, secret, 'all three holders get the SAME value');
});

test('SEC-003-২: signers are bound before the verifier, so a half-run converges', async () => {
  const { run, puts } = fakeRun();
  await provisionAlertProxySecret({ env: {}, run });
  const order = puts().map((c) => c.args.join(' '));
  const gkIndex = order.findIndex((line) => line.includes(`--name ${WORKER}`));
  assert.equal(gkIndex, order.length - 1, 'the verifier is bound last');
  for (const project of PAGES_PROJECTS) {
    assert.ok(
      order.findIndex((line) => line.includes(`--project-name ${project}`)) < gkIndex,
      `${project} must be bound before the verifier`,
    );
  }
});

test('SEC-003-৩: a failed signer binding never reaches the verifier', async () => {
  const { run, puts } = fakeRun({ failOn: `--project-name ${PAGES_PROJECTS[0]}` });
  await assert.rejects(
    () => provisionAlertProxySecret({ env: {}, run }),
    (err) => /binding ALERT_PROXY_SECRET on pages:admissionhub failed/.test(err.message),
  );
  assert.equal(
    puts().some((c) => c.args.join(' ').includes(`--name ${WORKER}`)), false,
    'the verifier must stay unbound so the next run rebinds all three',
  );
});

test('SEC-003-৪: an owner-provided value wins and is still bound to all three', async () => {
  const { run, puts } = fakeRun({ listed: [SECRET_NAME] });
  const { mode } = await provisionAlertProxySecret({ env: { [SECRET_NAME]: 'owner-supplied' }, run });
  assert.equal(mode, 'owner');
  assert.equal(puts().length, 3, 'an explicit rotation is honoured even when the name exists');
  for (const call of puts()) assert.equal(call.input, 'owner-supplied');
});

test('SEC-003-৫: an already-bound secret is not rotated', async () => {
  const { run, puts } = fakeRun({ listed: ['ADMIN_TOKEN', SECRET_NAME] });
  const { mode, holders } = await provisionAlertProxySecret({ env: {}, run });
  assert.equal(mode, 'already-bound');
  assert.deepEqual(holders, []);
  assert.equal(puts().length, 0, 'no write, so a working secret is never replaced by accident');
});

test('SEC-003-৬: an unreadable secret list refuses instead of guessing', async () => {
  const broken = async ({ args }) => {
    if (args.join(' ').startsWith('secret list')) return { code: 1, stdout: '', stderr: 'auth error' };
    throw new Error('must not bind after a failed read');
  };
  await assert.rejects(() => provisionAlertProxySecret({ env: {}, run: broken }), /refusing to guess/);
  const garbage = async () => ({ code: 0, stdout: 'not json', stderr: '' });
  await assert.rejects(() => provisionAlertProxySecret({ env: {}, run: garbage }), /did not return JSON/);
});

test('SEC-003-৭: the secret value never reaches argv or the log', async () => {
  const { run, calls } = fakeRun();
  const lines = [];
  const { secret } = await main(['provision'], { env: {}, run, log: (line) => lines.push(String(line)) });
  const logged = lines.join('\n');
  assert.ok(secret.length >= 64);
  assert.equal(logged.includes(secret), false, 'the value must never be printed');
  for (const call of calls) {
    assert.equal(call.args.join(' ').includes(secret), false, 'the value must travel on stdin, never in argv');
  }
  assert.match(logged, /generated \(32 random bytes\)/);
});

test('SEC-003-৮: the probe signature matches the Workers WebCrypto algorithm', async () => {
  const key = await subtle.importKey('raw', new TextEncoder().encode('shared-key'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = '{"message":""}';
  const ts = '1700000000000';
  const expected = [...new Uint8Array(await subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(alertSignature('shared-key', ts, body), expected);
});


const okFetch = (captured) => async (url, init) => {
  captured.url = url;
  captured.init = init;
  return { status: 400, text: async () => '{"error":"empty"}' };
};

test('SEC-003-৯: the chain is proven by a signed, silent 400 from the live origin', async () => {
  const captured = {};
  const res = await checkAlertProxyChain({
    pagesUrl: 'https://admissionhub.pages.dev', fetchImpl: okFetch(captured), sleep: async () => {},
  });
  assert.equal(res.ok, true);
  assert.equal(captured.url, 'https://admissionhub.pages.dev/api/report-error');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body, ALERT_PROBE_BODY);
  assert.equal(JSON.parse(ALERT_PROBE_BODY).message, '', 'an empty message is delivered to nobody');
  assert.equal(captured.init.headers['x-ah-pages-proxy'], '1');
  assert.equal(captured.init.headers['x-ah-proxy-sig'], INVALID_SIGNATURE,
    'the probe signature must be invalid: only a re-signing Pages worker can make it pass');
});

test('SEC-003-১০: a 403 fails the check and names the remedy', async () => {
  let calls = 0;
  const forbidden = async () => {
    calls += 1;
    return { status: 403, text: async () => '{"error":"forbidden"}' };
  };
  await assert.rejects(
    () => checkAlertProxyChain({
      pagesUrl: 'https://admissionhub.pages.dev', fetchImpl: forbidden, attempts: 3, sleep: async () => {},
    }),
    (err) => /do not both hold ALERT_PROXY_SECRET/.test(err.message) && /force a rebind/.test(err.message),
  );
  assert.equal(calls, 3, 'a stale deployment is retried before it is declared broken');
});

test('SEC-003-১১: a network error is retried and then reported, never swallowed', async () => {
  let calls = 0;
  const offline = async () => { calls += 1; throw new Error('ENOTFOUND'); };
  await assert.rejects(
    () => checkAlertProxyChain({
      pagesUrl: 'https://admissionhub.pages.dev', fetchImpl: offline, attempts: 2, sleep: async () => {},
    }),
    /network error: ENOTFOUND/,
  );
  assert.equal(calls, 2);
});
