import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// AUTH V2.0 (owner 2026-10-31).
//
// wrangler.auth.toml deploys `auth-worker-bundle.mjs`, which is the *login*
// script. A workflow that uploads it without proving the committed bundle
// matches a fresh build ships whatever bytes happen to be in the repo: an edit
// under auth-native/** can merge, the app bundle can be regenerated and pass
// its own check, and the live auth surface stays stale with every gate green.
//
// That was not hypothetical — `deploy-pages-worker.yml`, the workflow that
// publishes on every merge to main, did exactly this. It could not simply be
// edited: the repo's automation has no `workflow` scope, so GitHub refuses any
// commit that touches `.github/workflows/**` (verified three ways — git push,
// the Contents API, and the Agent patch workflow, whose own GITHUB_TOKEN was
// refused with "a GitHub App ... without `workflows` permission").
//
// So the fix is placed where it can actually live: `check:worker-bundle` now
// runs `check:auth-worker-bundle` first. Every workflow that already verified
// the app bundle — sixteen of them — now verifies the auth bundle too, and
// because the two are coupled in package.json the rule cannot be half-applied
// by editing a workflow.
//
// These tests hold that coupling in place. They are the reason it cannot be
// quietly undone later.
const WORKFLOW_DIR = new URL('./.github/workflows/', import.meta.url);
const pkg = () => JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const workflows = () => readdirSync(WORKFLOW_DIR)
  .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map(name => ({ name, text: readFileSync(new URL(name, WORKFLOW_DIR), 'utf8') }));

// A deploy of the auth Worker: a wrangler invocation pointed at wrangler.auth.toml.
const deploysAuthWorker = text => /wrangler[^\n]*deploy[^\n]*--config\s+wrangler\.auth\.toml/.test(text)
  || /wrangler[^\n]*--config\s+wrangler\.auth\.toml[^\n]*deploy/.test(text);

// Either the auth bundle is checked by name, or the app-bundle check is run —
// which, by the coupling asserted below, checks the auth bundle as well.
const verifiesAuthBundle = text => /npm run check:auth-worker-bundle/.test(text)
  || /npm run check:worker-bundle/.test(text);

test('checking the app bundle checks the auth bundle too', () => {
  const script = pkg().scripts['check:worker-bundle'] || '';
  assert.match(script, /npm run check:auth-worker-bundle/,
    'check:worker-bundle must run check:auth-worker-bundle, so the sixteen workflows '
    + 'that already call it cover the auth Worker without being edited');
  // The original body ends in `exit $code`, so anything placed after it is dead
  // text that still looks like a check. Assert the auth check runs first.
  const authAt = script.indexOf('check:auth-worker-bundle');
  const exitAt = script.indexOf('exit');
  assert.ok(exitAt === -1 || authAt < exitAt,
    'the auth check must run before the `exit` in check:worker-bundle, not after it');
});

test('rebuilding the app bundle rebuilds the auth bundle', () => {
  const script = pkg().scripts['build:worker'] || '';
  assert.match(script, /npm run build:auth-worker/,
    'build:worker must rebuild auth-worker-bundle.mjs as well, or a rebuild leaves '
    + 'the auth bundle stale while the app bundle is current');
});

test('the coupling is not vacuous: both bundle checks really compare bytes', () => {
  const { scripts } = pkg();
  for (const name of ['check:worker-bundle', 'check:auth-worker-bundle']) {
    assert.match(scripts[name] || '', /cmp -s/, `${name} must compare the committed file`);
    assert.match(scripts[name] || '', /esbuild/, `${name} must build the comparison from source`);
  }
});

test('every workflow that deploys the auth Worker verifies it first', () => {
  const offenders = workflows()
    .filter(({ text }) => deploysAuthWorker(text) && !verifiesAuthBundle(text))
    .map(({ name }) => name);

  assert.deepEqual(offenders, [],
    `these workflows deploy wrangler.auth.toml without any bundle check: ${offenders.join(', ')}`);
});

test('the rule is not vacuous: the automatic publish path deploys it and is covered', () => {
  const text = readFileSync(new URL('deploy-pages-worker.yml', WORKFLOW_DIR), 'utf8');
  assert.match(text, /on:[\s\S]*push:[\s\S]*branches:\s*\[main\]/,
    'this is the workflow that publishes on every merge to main');
  assert.ok(deploysAuthWorker(text), 'it deploys the auth Worker');
  assert.ok(verifiesAuthBundle(text), 'so it must verify a bundle before uploading');
});
