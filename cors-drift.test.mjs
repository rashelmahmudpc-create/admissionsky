// AU-SEC-05 (2026-10-30 audit) — the allowlist had drifted into four copies.
//
// cors-policy.mjs matches hostnames exactly, but gk-agent-worker.js,
// voice-worker.js and notification-worker.js each kept their own regex:
//
//   /^https:\/\/([a-z0-9-]+\.)?(admissionsky|admissionhub)\.pages\.dev$/
//
// `([a-z0-9-]+\.)?` accepts ANY subdomain, so `evil.admissionsky.pages.dev` --
// a name the owner does not control -- passed as the app's own origin and got
// `Access-Control-Allow-Origin` plus credentials. Production was never exposed
// because the request path goes through the handler, which uses cors-policy.mjs;
// the copies were the trap waiting for the next refactor.
//
// These tests pin the two things that must stay true: the shared rule rejects
// lookalike hosts, and no file goes back to restating the rule by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedOrigin } from './cors-policy.mjs';

const ALLOWED = [
  'https://admissionsky.pages.dev',
  'https://admissionhub.pages.dev',
  'https://admission-gk.admissionhub.workers.dev'
];

const REJECTED = [
  // The hole this audit closed: any subdomain used to pass.
  'https://evil.admissionsky.pages.dev',
  'https://x.admissionhub.pages.dev',
  'https://admissionsky.pages.dev.evil.com',
  'https://evil.com',
  // Dropped deliberately on 2026-10-22 (D-5): preview builds and dev machines.
  'https://abc123.admissionhub.pages.dev',
  'http://localhost:8788',
  'http://127.0.0.1:3000',
  // Scheme and port games.
  'http://admissionsky.pages.dev',
  'https://admissionsky.pages.dev:8443',
  ''
];

test('AU-SEC-05: the shared policy accepts only the app\'s own hosts', () => {
  for (const origin of ALLOWED) assert.equal(allowedOrigin(origin), true, origin);
  for (const origin of REJECTED) assert.equal(allowedOrigin(origin), false, origin);
});

test('AU-SEC-05: no worker restates the origin rule by hand', () => {
  // A hand-written copy is what drifted. The shared policy is the only place
  // allowed to name the hosts in a regex.
  const files = ['gk-agent-worker.js', 'voice-worker.js', 'notification-worker.js'];
  for (const file of files) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      src,
      /\(\?:\)\?\(admissionsky\|admissionhub\)|\(\[a-z0-9-\]\+\\\.\)\?\(admissionsky/,
      `${file} must call allowedOrigin() from cors-policy.mjs, not repeat the pattern`
    );
    assert.match(
      src,
      /from '\.\/cors-policy\.mjs'/,
      `${file} must import the shared policy`
    );
  }
});

test('AU-SEC-05: the workers that gained an import can still be deployed as one file', () => {
  // voice-worker.js and notification-worker.js are uploaded as a single file.
  // Wrangler bundles their imports by default (verified 2026-10-30 with
  // `wrangler deploy --dry-run`: cors-policy.mjs lands in the upload), so the
  // deploy workflows need no change -- but a future switch to
  // `--no-bundle` would silently break both, so pin the assumption.
  const voice = readFileSync(new URL('./.github/workflows/voice-worker-deploy.yml', import.meta.url), 'utf8');
  const notify = readFileSync(new URL('./.github/workflows/notify-worker-deploy.yml', import.meta.url), 'utf8');
  for (const [name, wf] of [['voice-worker-deploy', voice], ['notify-worker-deploy', notify]]) {
    assert.doesNotMatch(wf, /--no-bundle/,
      `${name} must let wrangler bundle the cors-policy.mjs import`);
  }
});
