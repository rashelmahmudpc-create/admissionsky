/* SEC-003 (2026-10-30 audit) — provision and prove the browser-error alert chain.
 *
 * The chain is: `_worker.js` (Pages Function) signs POST /api/report-error with
 * ALERT_PROXY_SECRET -> admission-gk verifies the timestamped HMAC and only then
 * talks to Telegram. Neither side may run without the secret, so both fail
 * closed; but NOBODY had ever bound the secret, so every real browser error was
 * answered 403 and the alert channel was dead while the deploy looked green.
 *
 * The old deploy step could not fix that and could not report it: it echoed a
 * `::warning` and exited 0 when the repository secret was missing, so a green run
 * meant "we did not try", not "it works". This script replaces it with three
 * properties:
 *
 *   1. It provisions instead of waiting. With no repository secret it generates
 *      32 random bytes ONCE (when admission-gk does not list the name yet) and
 *      binds the same value to both signers and the verifier. A value the owner
 *      puts in the repository secret still wins.
 *   2. Signers are bound FIRST, the verifier LAST. A run that dies half way then
 *      leaves the verifier unbound, and the next deploy regenerates and rebinds
 *      all three, so the three converge. The other order would leave the verifier
 *      holding a value no signer ever got — a permanent 403 that looks like a code
 *      bug.
 *   3. It proves the chain afterwards without spending a Telegram message. The
 *      probe below posts an EMPTY message through the live Pages origin with a
 *      deliberately INVALID signature: if the Pages worker holds the secret it
 *      replaces those headers with its own and the verifier answers `400 empty`;
 *      if either side lacks the secret — or the two values differ — the forged
 *      pair reaches the verifier and is refused with 403. `400 empty` is the only
 *      answer that is both signed and delivered to nobody.
 *
 * The value never appears in argv (argv is logged) and never in this script's
 * output; it only ever crosses a pipe into `wrangler secret put`.
 *
 * CLI:  node scripts/bind-alert-proxy-secret.mjs provision
 *       node scripts/bind-alert-proxy-secret.mjs verify --pages https://admissionhub.pages.dev
 */
import { randomBytes, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SECRET_NAME = 'ALERT_PROXY_SECRET';
export const WORKER = 'admission-gk';
/* Both Pages projects run _worker.js, so both must be able to sign. */
export const PAGES_PROJECTS = ['admissionhub', 'admissionsky'];
export const DEFAULT_WRANGLER = 'npx --yes wrangler@4.35.0';
/* Signed only to reach the verifier's gate; the handler rejects an empty message
 * BEFORE it builds or sends a Telegram message, so the probe is silent. */
export const ALERT_PROBE_BODY = '{"message":""}';
export const INVALID_SIGNATURE = '00'.repeat(32);

/* `wrangler` is spawned, never shell-interpolated, and the secret goes in on
 * stdin so it cannot show up in a process list or an action log. */
export function spawnRunner(wrangler = DEFAULT_WRANGLER) {
  const [cmd, ...head] = String(wrangler).split(/\s+/).filter(Boolean);
  return ({ args, input = '' }) => new Promise((resolve, reject) => {
    const child = spawn(cmd, [...head, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/* Names only. `wrangler secret list` never returns a value. A failed or
 * unparseable read REFUSES to continue: an empty read must not be mistaken for
 * "nothing bound", or this would silently rotate a working secret. */
export async function listSecretNames(run) {
  const { code, stdout, stderr } = await run({
    args: ['secret', 'list', '--name', WORKER, '--format', 'json'],
  });
  if (code !== 0) {
    throw new Error(`wrangler secret list failed (exit ${code})${stderr ? `: ${String(stderr).trim().slice(0, 200)}` : ''}; refusing to guess whether ${SECRET_NAME} is bound`);
  }
  let rows;
  try {
    rows = JSON.parse(String(stdout || '').trim() || '[]');
  } catch (_) {
    throw new Error('wrangler secret list did not return JSON; refusing to guess whether the alert secret is bound');
  }
  if (!Array.isArray(rows)) {
    throw new Error('wrangler secret list returned no array; refusing to guess whether the alert secret is bound');
  }
  return rows.map((row) => (typeof row === 'string' ? row : row && row.name)).filter(Boolean);
}

async function put(run, args, secret, holder) {
  const { code } = await run({ args, input: secret });
  if (code !== 0) {
    throw new Error(`binding ${SECRET_NAME} on ${holder} failed (exit ${code}); the alert channel is NOT wired`);
  }
}

/* Returns { mode, holders, secret }. `secret` is returned so a caller can verify
 * in the same process; nothing here prints it. */
export async function provisionAlertProxySecret({ env = process.env, run } = {}) {
  if (typeof run !== 'function') throw new TypeError('provisionAlertProxySecret needs a run() function (see spawnRunner)');
  const owner = String(env[SECRET_NAME] || '').trim();
  const listed = await listSecretNames(run);
  if (!owner && listed.includes(SECRET_NAME)) {
    /* Already provisioned. The `verify` step is what proves the value still
     * reaches every holder — a skip here is never treated as proof on its own. */
    return { mode: 'already-bound', holders: [], secret: '' };
  }
  const secret = owner || randomBytes(32).toString('hex');
  const holders = [];
  for (const project of PAGES_PROJECTS) {
    await put(run, ['pages', 'secret', 'put', SECRET_NAME, '--project-name', project], secret, `pages:${project}`);
    holders.push(`pages:${project}`);
  }
  await put(run, ['secret', 'put', SECRET_NAME, '--name', WORKER], secret, `worker:${WORKER}`);
  holders.push(`worker:${WORKER}`);
  return { mode: owner ? 'owner' : 'generated', holders, secret };
}

/* Identical to alertSignature() in gk-agent-worker.js: HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, lowercase hex. A test computes the same digest
 * through WebCrypto — the API the deployed Workers actually use — so the two
 * implementations cannot drift apart unnoticed. */
export function alertSignature(secret, timestamp, body) {
  return createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex');
}

export async function checkAlertProxyChain({
  pagesUrl,
  fetchImpl = fetch,
  attempts = 5,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!pagesUrl) throw new TypeError('checkAlertProxyChain needs the live Pages origin (--pages https://...)');
  if (!/^https:\/\//i.test(String(pagesUrl))) throw new TypeError('--pages must be an absolute https origin');
  const url = new URL('/api/report-error', pagesUrl).toString();
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status = 0;
    let body = '';
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ah-pages-proxy': '1',
          'x-ah-proxy-ts': String(Date.now()),
          'x-ah-proxy-sig': INVALID_SIGNATURE,
        },
        body: ALERT_PROBE_BODY,
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      last = `network error: ${(err && err.message) || err}`;
    }
    if (status === 400) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) { /* reported below */ }
      if (parsed && parsed.error === 'empty') return { ok: true, status, attempts: attempt, url };
      last = `400 with an unexpected body: ${String(body).slice(0, 120)}`;
    } else if (status) {
      last = `HTTP ${status}: ${String(body).slice(0, 120)}`;
    }
    if (attempt < attempts) await sleep(6000);
  }
  throw new Error(
    `${url} did not re-sign the probe (${last}). The Pages worker and ${WORKER} do not both hold ${SECRET_NAME}`
    + ' — or the two values differ, which looks the same from outside. To force a rebind, set the repository secret'
    + ` ${SECRET_NAME} (any value) or delete it from ${WORKER}, then re-run this workflow.`,
  );
}

export async function main(argv = process.argv.slice(2), {
  env = process.env, run = spawnRunner(env.WRANGLER_CMD || DEFAULT_WRANGLER), fetchImpl = fetch, log = console.log,
} = {}) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'provision';
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : '';
  };
  if (command === 'provision') {
    const { mode, holders, secret } = await provisionAlertProxySecret({ env, run });
    if (mode === 'already-bound') {
      log(`${SECRET_NAME} is already bound to ${WORKER}; nothing written. The verify step still has to prove it.`);
    } else {
      const how = mode === 'owner' ? 'taken from the repository secret' : 'generated (32 random bytes)';
      log(`${SECRET_NAME} ${how} and bound to: ${holders.join(', ')}`);
    }
    /* `secret` is returned so a caller can verify in the same process; the CLI
     * below ignores it and nothing here ever prints it. */
    return { mode, holders, secret };
  }
  if (command === 'verify') {
    const result = await checkAlertProxyChain({ pagesUrl: flag('pages'), fetchImpl });
    log(`alert chain ok: ${result.url} re-signed the probe and ${WORKER} accepted it (attempt ${result.attempts}).`);
    return result;
  }
  throw new Error(`unknown command "${command}" (expected provision | verify)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`::error title=Alert channel not wired::${(err && err.message) || err}`);
      process.exit(1);
    });
}

